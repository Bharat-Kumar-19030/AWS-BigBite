import dotenv from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import express from 'express';
import crypto from 'crypto';
import * as z from "zod";

// ✅ CORRECT imports — fix for all previous crashes
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { ChatGroq } from "@langchain/groq";
import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";

// ─── Groq Key Rotator (handles 429 + tool_use_failed + 413 overflow) ─────
import { callWithGroqRotation, getNextGroqApiKey, GroqTokenOverflowError } from '../utils/groqKeyRotator.js';

import {
  getWishlistsHandler,
  createWishlistHandler,
  updateWishlistNameHandler,
  addItemToWishlistHandler,
  updateItemQuantityHandler,
  removeItemFromWishlistHandler,
  deleteWishlistHandler,
  getWishlistByIdHandler
} from './wishlist.js';

import {
  getMenuItemsHandler,
  createMenuItemHandler,
  updateMenuItemHandler,
  deleteMenuItemHandler,
  toggleKitchenHandler,
  getAllRestaurantsHandler,
} from './restaurant.js';

import {
  createPendingOrderHandler,
  confirmOrderHandler,
  placeOrderHandler,
  riderAcceptOrderHandler,
  verifyPickupPinHandler,
  verifyDeliveryPinHandler,
  updateOrderStatusHandler,
  getCustomerOrdersHandler,
  getAvailableOrdersHandler,
  getRiderOrdersHandler,
  getOrderByIdHandler,
  updateRiderLocationHandler,
  getRestaurantOrdersHandler,
} from './order.js';

import {
  createPaymentOrderHandler,
  verifyPaymentHandler,
  getPaymentStatusHandler,
} from './payment.js';

import {
  getCartHandler,
  addToCartHandler,
  updateCartHandler,
  removeFromCartHandler,
  clearCartHandler,
} from './cart.js';

import {
  getMeHandler,
  updateProfileHandler,
  logoutHandler,
} from './auth.js';

import {
  registerRiderHandler,
  getRiderStatsHandler,
  toggleRiderAvailabilityHandler,
  updateRiderLocationHandler as updateRiderProfileLocationHandler,
} from './rider.js';

import {
  submitRatingHandler,
  getRestaurantRatingHandler,
} from './rating.js';

// ─── Load .env ────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, "../.env") });

// ─── Backend payment-data encryptor (mirrors frontend encryption.js) ─
function encryptPaymentDataBackend(data) {
  const SECRET = process.env.PAYMENT_SECRET || 'bigbite-payment-secret-2024';
  const base64Data = Buffer.from(JSON.stringify(data)).toString('base64');
  const signature = crypto.createHmac('sha256', SECRET).update(base64Data).digest('hex');
  return `${base64Data}.${signature}`;
}

console.log("GROQ KEYy:", process.env.GROQ_API_KEY ? `✅ Loaded = ${process.env.GROQ_API_KEY}` : "❌ NOT FOUND");

const router = express.Router();

// ─── System Prompt ────────────────────────────────────────────────
const systemPrompt = `
You are BigBite, an intelligent food delivery agent.
You operate on behalf of authenticated users and have full authority to interact with all backend APIs.
Always use tools to fetch real data — never guess or fabricate responses.
Be concise and natural since this is a voice-first interface.
Use Indian context — prices in ₹ (INR), payment via Razorpay.
Do not take random actions when the user does not specify clearly. In this case ask and confirm the user's requirements again.
Very very important to confirm before irreversible actions like placing orders, payments, or deletions.

IMPORTANT RULES (STRICT):
1. Never call the same tool twice in a row with the same arguments.
2. NEVER emit a text message to the user mid-flow. Do NOT say things like "Please wait...", "I will now...", "One moment...", "Let me do X...", or "Processing..." BEFORE completing all required tool calls. These partial messages cause the agent to halt and wait for user input, breaking the flow. Only speak AFTER all tools for the current task have been called and results received.
3. If a task requires multiple sequential tool calls (e.g. create_pending_order → initiate_online_payment), call ALL of them in the same turn before producing your final reply to the user.
4. Exception: If you genuinely need to ask the user a question (missing required info, confirmation before irreversible action), you may speak — but ONLY after finishing any tools that do not require that info.
5. NEVER show your internal reasoning, planning steps, or chain-of-thought to the user. Do NOT output "## Step 1", "## Step 2", "Step 3:", "No function call needed", or any other meta-commentary about what you are doing. Think silently and only output the final, clean reply.
6. NEVER output raw JSON, objects, or data structures in your reply to the user. Do NOT write things like {"clear": true}, {"success": false}, or any bracket/brace notation. Your response to the user must ALWAYS be plain natural language sentences or formatted lists — never raw code or JSON.
7. When a tool returns a conflict, warning, or error (e.g. cart has items from a different restaurant), translate the result into a clear, friendly natural-language message. For example, instead of echoing {"clear": true}, say: "Your cart already has items from **[Restaurant Name]**. Would you like me to clear the cart so I can add items from the new restaurant instead? 🛒"

RESTAURANT OWNER RULES:
- Tools like create_menu_item, update_menu_item, delete_menu_item, toggle_kitchen are ONLY for restaurant owners.
- If a regular user (role !== 'restaurant') tries to use them, deny and explain they are restaurant-only features.
- Before deleting a menu item, always confirm with the owner.
- Before toggling kitchen OFF, warn that active orders will block it.

AUTHENTICATION RULES (STRICT):
Every message begins with a [USER STATUS] tag. You must read it first.

If USER STATUS is "Guest — Not logged in":
  - You are in GUEST MODE.
  - NEVER call any tool, under any circumstance.
  - You may only answer general questions: what is BigBite, how does it work, what cuisines are available, etc.
  - If the user asks to do ANYTHING that requires an account, respond:
    "You need to be logged in to do that. Please sign in or create an account to continue."
  - Do NOT attempt to help them perform the action in any other way.

If USER STATUS is "Authenticated":
  - You are in FULL MODE.
  - You may call tools freely to perform actions on behalf of the user.
  - Always use tools to fetch real data — never guess or fabricate responses.
  - Confirm before irreversible actions like placing orders, payments, or deletions.
  - Do not take random actions when the user does not specify clearly — ask and confirm first.

You have access to tools for:
- fetching menu items
- placing orders
- confirming payments
- tracking orders
- viewing and updating user profile
- logging out

Rules:
- ALWAYS use tools for real data (orders, menus, payments, profile)
- NEVER hallucinate order details or profile data
- Ask user for missing information (address, items, payment)
- If user confirms order → call place_order
- If payment involved → call create_pending_order then initiate_online_payment
- Maintain context of user's cart and order

AUTH / PROFILE RULES:
- To show profile info, call get_me (no arguments needed).
- To update name, phone, address, avatar: call update_profile with only the fields to change.
- Never modify role, email, or password via update_profile unless the user explicitly requests it.
- logout clears the session on the frontend. Confirm with user before calling it.

CART RULES:
- do not add more than 1 restaurant items in the cart at one time , if the user tries to add items from different restaurants in the 
  cart give him warning that you cannot add items from different restaurants into the cart.
- Always call get_cart before remove_from_cart or update_cart so you have current item _ids.
- Never call add_to_cart without menuItem _id, restaurantId, and quantity.
  If missing, fetch restaurant/menu data first or ask the user.
- clear_cart is irreversible — always confirm with the user before calling it.
- If the user wants to change quantity of an existing cart item, use update_cart
  with the full current cart (fetched via get_cart) and the modified quantity.
PAYMENT RULES:
- Amount is always in ₹ (rupees), never in paise.
- For COD orders: skip create_payment_order / verify_payment / create_pending_order entirely — just call place_order with paymentMethod:'cod'.
- NEVER call verify_payment without all three Razorpay fields.
- If create_payment_order returns gatewayUnavailable:true, switch to COD and inform the user.

ORDER PLACEMENT FLOW — MANDATORY SEQUENCE:

0. ADDRESS CHECK (do this BEFORE anything else, every time):
   - Read the [USER STATUS] header in the current message. It contains the user's address and coordinates.
   - If coordinates are present (lat + lng shown): use them for the delivery fee calculation (₹8/km from restaurant to user).
   - If the header says "coordinates: NOT SET" but an address string is present: inform the user their address is saved but has no GPS coordinates, and ask them to confirm their location or provide coordinates.
   - If the header says "address: NOT SET": ask the user for their delivery address BEFORE proceeding. Do NOT assume pickup. NEVER set deliveryFee to ₹0 just because no address was provided — always ask first.

1. ALWAYS ask payment method FIRST before doing anything:
   "How would you like to pay?\n1️⃣ Cash on Delivery (COD)\n2️⃣ Online (UPI / Card / Net Banking)"
   Wait for the user's reply.

2. COD flow:
   a. Confirm items + address + pricing with user.
   b. Call place_order (paymentMethod:'cod').
   c. Call clear_cart (clears DB cart).
   d. Call refresh_cart_ui (clears frontend cart display).
   e. Call navigate_to path='/orders'.
   f. Tell user order is placed.

3. ONLINE flow (strict sequence — do NOT skip steps):
   a. Confirm items + address + pricing with user.
   b. Calculate pricing: subtotal, deliveryFee (₹8/km), platformFee ₹5, GST 5% of subtotal, totalAmount.
   c. Call create_pending_order → get orderId.
   d. Call initiate_online_payment with orderId + totalAmount.
      → The payment tab opens automatically in user's browser.
   e. IMMEDIATELY after calling initiate_online_payment, show this EXACT format (fill in real values):

      "Your order reference is #[last 8 chars of orderId].

      Here's the price breakup for your order:
      [list each cart item as: • [Name] ([qty] piece/pieces) — ₹[price × qty]]
      • Delivery Fee: ₹[deliveryFee]
      • Platform Fee: ₹5
      • GST (5%): ₹[gst]
      ─────────────────
      **Total: ₹[totalAmount]**

      I've opened the payment page in a new tab. Please complete your payment there and I'll confirm your order automatically. 🔐"

   f. WAIT — do not call any more tools. The frontend will automatically send a PAYMENT_RESULT message.

ORDER REFERENCE FORMAT RULE:
- NEVER show the full MongoDB _id (e.g. 69ed129c7ce8efc915400d56).
- Always abbreviate it as #[last 8 characters], e.g. #15400d56.
- Apply this rule everywhere you mention an order ID to the user.

4. When a message starts with "PAYMENT_RESULT:" parse it:
   Format A (success): "PAYMENT_RESULT: success | ref=<orderId> | razorpay_order_id=<x> | razorpay_payment_id=<y> | razorpay_signature=<z>"
   Format B (failed):  "PAYMENT_RESULT: failed | ref=<orderId>"

   On success:
     - Call confirm_order_after_payment with orderId + all three razorpay fields.
     - Call clear_cart (DB).
     - Call refresh_cart_ui (frontend).
     - Call navigate_to path='/track-order/<orderId>'.
     - Tell user payment + order confirmed.
   On failed:
     - Inform user. Offer to retry (call initiate_online_payment again with same orderId) or switch to COD.

KEY FIELD REFERENCE (use these exact field names in tool calls):

User: { _id, name, email, phone, role(customer|rider|restaurant|admin), avatar, address{street,city,state,zipCode,country,latitude,longitude}, restaurantDetails{kitchenName,cuisine[],description,address,isKitchenOpen,isVerified,rating{average,count}}, riderDetails{vehicleType,vehicleNumber,licenseNumber,isAvailable,totalDeliveries,totalEarnings,rating{average,count}} }

MenuItem: { _id, restaurantId, name, description, price(₹), category(Starter|Main Course|Dessert|Beverage|Snacks), cuisine(Indian|Chinese|Italian|Mexican|Thai|Japanese|French|Mediterranean|American|Korean|Middle Eastern|Continental), subCategory(Pizza|Burger|Pasta|Noodles|Rice|Sandwich|Salad|Soup|Curry|Biryani|Kebab|Meal|Cake|Dessert|Juice|Coffee|Tea), image, isVeg(bool), isAvailable(bool) }

Order: { _id, customer(_id), restaurant(_id), items[{menuItem,name,price,quantity}], deliveryAddress{street,city,state,zipCode,country,latitude,longitude,fullAddress}, paymentMethod(cod|online), paymentStatus(pending|paid|failed), subtotal, deliveryFee, platformFee, gst, totalAmount, status(pending_payment|pending|accepted|awaiting_rider|rejected|auto_rejected|rider_assigned|preparing|ready|picked_up|on_the_way|delivered|cancelled), pickupPin, deliveryPin }

Wishlist: { _id, user, name, restaurant, items[{menuItem,name,price,quantity}] }

Payment: { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount(paise), status(CREATED|SUCCESS|FAILED), referenceId }

LOCATION RULES:
- NEVER call get_all_restaurants without latitude and longitude.
- Use user's saved address (latitude/longitude) from context automatically.
- If location is missing, ask the user first.

NAVIGATION RULES:
Navigation is split into two categories:

A) AUTOMATIC — built into tool handlers, happens without you calling navigate_to:
   - get_cart / add_to_cart / remove_from_cart / update_cart  →  /cart
   - get_customer_orders                                        →  /orders
   - place_order (COD, on success)                             →  /orders
   - confirm_order_after_payment (on success)                  →  /track-order/:orderId
   - get_wishlists / create_wishlist / add_item_to_wishlist    →  /wishlists
   - get_rider_stats                                           →  /rider/dashboard
   - get_all_restaurants (when user asks about a specific restaurant or its menu) → /restaurant/:restaurantId
   Do NOT call navigate_to for any of the above — it is already handled.

B) EXPLICIT INTENT — call navigate_to ONLY when the user clearly asked to go somewhere:
   - User asks to browse / explore restaurants / what to eat / what can I order / show me food  →  navigate_to /
   - User says "go home" or "take me to the main page"  →  navigate_to /
   - User asks about a restaurant or its menu  →  navigate_to /restaurant/:restaurantId
   - User asks to see a specific menu item     →  navigate_to /restaurant/:restaurantId/item/:itemId
   - User says "show my profile / edit profile / my account"  →  navigate_to /profile
   - User says "show my orders / order history"               →  navigate_to /orders  (if get_customer_orders not already called)
   - User says "track my order"                               →  navigate_to /track-order/:orderId
   - User says "open rider dashboard"                         →  navigate_to /rider/dashboard
   - User says "open restaurant dashboard"                    →  navigate_to /restaurant-dashboard
   - User asks about wishlists / saved items                  →  navigate_to /wishlists (if get_wishlists not already called)
   - User wants to register as rider                          →  navigate_to /rider-registration
   - User wants to register a restaurant                      →  navigate_to /restaurant-registration

CRITICAL: get_me is a background utility tool used to fetch user data (address, name) during order flows. Calling get_me does NOT mean the user wants to view their profile page. NEVER navigate_to /profile just because you called get_me.

RATING RULES:
- Only delivered orders can be rated. Check order status before offering to rate.
- submit_rating accepts restaurantRating(1-5), restaurantReview(text), riderRating(1-5), riderReview(text).
- At least one of restaurantRating or riderRating must be provided.
- After an order is delivered, proactively ask the customer if they want to rate the experience.
- get_restaurant_rating is read-only — use it when user asks 'what is the rating of X restaurant'.

WISHLIST RULES:
- A wishlist belongs to a user and stores menu items from a SINGLE restaurant only.
- NEVER add items from a different restaurant to an existing wishlist — warn the user and stop.
- If the user wants items from multiple restaurants, they must create separate wishlists (one per restaurant).
- Use get_wishlists to list all wishlists, get_wishlist_by_id for a specific one.
- create_wishlist requires name and restaurantId. ALWAYS use the restaurant's MongoDB _id (from get_all_restaurants), NEVER the restaurant name string.
- add_item_to_wishlist requires wishlistId, menuItem(_id), name, price, quantity.
- Before adding an item, verify that item's restaurantId matches the wishlist's restaurantId.
- Always fetch wishlists first before adding/removing items so you have current _ids.
- delete_wishlist is irreversible — confirm before calling.

RIDER RULES (for riders logged in as rider role):
- get_rider_stats: no arguments, shows deliveries, earnings, rating.
- toggle_rider_availability: pass isAvailable=true to go online, false to go offline.
- get_available_orders: shows orders ready for pickup near the rider.
- rider_accept_order: requires orderId and riderId.
- verify_pickup_pin: rider enters PIN from restaurant to confirm pickup.
- verify_delivery_pin: rider enters PIN from customer to confirm delivery and update earnings.
- register_rider: all 6 fields required — ask user for any missing ones before calling.

RESPONSE FORMATTING RULES (MANDATORY — apply to every reply):
1. Use **bold text** to highlight important information: item names, restaurant names, prices, order totals, statuses, and key action words (e.g. **Shahi Paneer**, **₹150**, **Cash on Delivery**, **Order Placed**).
2. Use a maximum of 2 emojis per reply. Choose emojis that are contextually relevant to the topic (e.g. 🍕 for food/ordering, ✅ for success/confirmation, 📦 for orders, 💳 for payments, 🛵 for delivery, ⭐ for ratings). Never use emojis randomly or excessively.
3. Do NOT bold every single word — only bold the most important terms that deserve user attention.
4. Keep the overall tone friendly, concise, and natural.
`;

const groqNumber = z.preprocess((val) => {
  if (val == null) return null;
  if (typeof val === 'object' && 'value' in val) return Number(val.value); // ← fixes the bug
  return Number(val);
}, z.number().nullable().optional());

// Coerce string booleans from LLM output ("true"/"false") → actual boolean
// Uses a plain function (NOT z.preprocess) so JSON Schema serialization works.
function toBool(val, fallback = undefined) {
  if (val === undefined || val === null) return fallback;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return val.toLowerCase() === 'true';
  if (typeof val === 'number') return val !== 0;
  return fallback;
}

// ------------------cart tools-----------------------

// ─── Cart Tools ───────────────────────────────────────────────────

// ─── 1. Get Cart ──────────────────────────────────────────────────
const getCartTool = tool(
  async (_, config) => {
    try {
      const user = config?.configurable?.user;
      const pa = config?.configurable?.pendingActions;
      const req = { user: { id: user._id || user.id }, body: {}, params: {}, query: {} };
      const res = buildMockRes();
      await getCartHandler(req, res);
      const { statusCode, responseData } = res.getData();
      if (statusCode === 200 && responseData?.success) {
        if (Array.isArray(pa)) {
          pa.push({ type: 'REFRESH_CART' });
          pa.push({ type: 'NAVIGATE', path: '/cart' });
        }
        return JSON.stringify({ success: true, cart: responseData.cart });
      }
      return JSON.stringify({ success: false, message: responseData?.message || 'Failed to fetch cart' });
    } catch (e) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
  {
    name: 'get_cart',
    description: `Fetches the current user's cart with full item and restaurant details.
No input needed. Use when user says:
'show my cart', 'what's in my cart', 'view cart', 'check my order'.`,
    schema: z.object({}),
  }
);

// ─── 2. Add to Cart (with restaurant conflict guard) ──────────────
const addToCartTool = tool(
  async ({ menuItem, quantity, restaurantId }, config) => {
    try {
      const user = config?.configurable?.user;
      const pa = config?.configurable?.pendingActions;
      const qty = toNum(quantity, 1);

      const cartReq = { user: { id: user._id || user.id }, body: {}, params: {}, query: {} };
      const cartRes = buildMockRes();
      await getCartHandler(cartReq, cartRes);
      const { responseData: cartData } = cartRes.getData();

      if (cartData?.success && cartData.cart?.length > 0) {
        const existingRestaurantId =
          cartData.cart[0]?.restaurantId?._id?.toString() ||
          cartData.cart[0]?.restaurantId?.toString();
        if (existingRestaurantId && existingRestaurantId !== restaurantId.toString()) {
          return JSON.stringify({
            success: false, conflict: true,
            message: "Your cart already has items from a different restaurant. Please clear your cart first before adding items from a new restaurant. Would you like me to clear the cart?",
            currentRestaurantId: existingRestaurantId,
            requestedRestaurantId: restaurantId,
          });
        }
      }

      const req = { user: { id: user._id || user.id }, body: { menuItem, quantity: qty, restaurantId }, params: {}, query: {} };
      const res = buildMockRes();
      await addToCartHandler(req, res);
      const { statusCode, responseData } = res.getData();
      if (statusCode === 200 && responseData?.success) {
        if (Array.isArray(pa)) {
          pa.push({ type: 'REFRESH_CART' });
          pa.push({ type: 'NAVIGATE', path: '/cart' });
        }
        return JSON.stringify({ success: true, message: responseData.message, cart: responseData.cart });
      }
      return JSON.stringify({ success: false, message: responseData?.message || 'Failed to add item to cart' });
    } catch (e) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
  {
    name: 'add_to_cart',
    description: `Adds a menu item to the user's cart. If item already exists, quantity is incremented.
IMPORTANT: If the cart already contains items from a DIFFERENT restaurant, this tool will
return a conflict error and ask the user to clear the cart first — never mix restaurants.
Use when user says: 'add to cart', 'I want to order X', 'order 2 of Y', 'add X quantity of Y'.
You MUST have menuItem _id, restaurantId, and quantity before calling.
If any are missing, call get_all_restaurants first to find them.
If a conflict is returned, ask the user if they want to clear the cart before proceeding.`,
    schema: z.object({
      menuItem: z.string().describe('MongoDB _id of the menu item'),
      quantity: z.any().describe('Quantity to add as a number, minimum 1'),
      restaurantId: z.string().describe('MongoDB _id of the restaurant this item belongs to'),
    }),
  }
);

// ─── 3. Remove from Cart ──────────────────────────────────────────
const removeFromCartTool = tool(
  async ({ menuItemId }, config) => {
    try {
      const user = config?.configurable?.user;
      const pa = config?.configurable?.pendingActions;
      const req = { user: { id: user._id || user.id }, body: {}, params: { menuItemId }, query: {} };
      const res = buildMockRes();
      await removeFromCartHandler(req, res);
      const { statusCode, responseData } = res.getData();
      if (statusCode === 200 && responseData?.success) {
        if (Array.isArray(pa)) {
          pa.push({ type: 'REFRESH_CART' });
          pa.push({ type: 'NAVIGATE', path: '/cart' });
        }
        return JSON.stringify({ success: true, message: responseData.message, cart: responseData.cart });
      }
      return JSON.stringify({ success: false, message: responseData?.message || 'Failed to remove item from cart' });
    } catch (e) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
  {
    name: 'remove_from_cart',
    description: `Removes a specific item from the user's cart entirely.
Use when user says: 'remove from cart', 'delete this item', 'I don't want X anymore'.
If you don't have the menuItem _id, call get_cart first to find it.`,
    schema: z.object({
      menuItemId: z.string().describe('MongoDB _id of the menu item to remove'),
    }),
  }
);

// ─── 4. Update Cart (bulk replace) ────────────────────────────────
const updateCartTool = tool(
  async ({ cart }, config) => {
    try {
      const user = config?.configurable?.user;
      const pa = config?.configurable?.pendingActions;
      const sanitizedCart = cart.map(item => ({ ...item, quantity: toNum(item.quantity, 1) }));
      const req = { user: { id: user._id || user.id }, body: { cart: sanitizedCart }, params: {}, query: {} };
      const res = buildMockRes();
      await updateCartHandler(req, res);
      const { statusCode, responseData } = res.getData();
      if (statusCode === 200 && responseData?.success) {
        if (Array.isArray(pa)) {
          pa.push({ type: 'REFRESH_CART' });
          pa.push({ type: 'NAVIGATE', path: '/cart' });
        }
        return JSON.stringify({ success: true, message: responseData.message, cart: responseData.cart });
      }
      return JSON.stringify({ success: false, message: responseData?.message || 'Failed to update cart' });
    } catch (e) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
  {
    name: 'update_cart',
    description: `Replaces the entire cart with a new list of items. Use for bulk edits like
changing multiple quantities at once. Prefer add_to_cart or remove_from_cart for single items.
ALWAYS call get_cart first to get the current state before modifying.
Use when user says: 'change quantity of X to 3', 'update my cart', 'edit my order'.`,
    schema: z.object({
      cart: z.array(
        z.object({
          menuItem: z.string().describe('MongoDB _id of the menu item'),
          quantity: z.any().describe('Desired quantity as a number, minimum 1'),
          restaurantId: z.string().describe('MongoDB _id of the restaurant'),
        })
      ).describe('Full replacement cart — must include ALL items you want to keep'),
    }),
  }
);

// ─── 5. Clear Cart ────────────────────────────────────────────────
const clearCartTool = tool(
  async (_, config) => {
    try {
      const user = config?.configurable?.user;
      const pa = config?.configurable?.pendingActions;
      const req = { user: { id: user._id || user.id }, body: {}, params: {}, query: {} };
      const res = buildMockRes();
      await clearCartHandler(req, res);
      const { statusCode, responseData } = res.getData();
      if (statusCode === 200 && responseData?.success) {
        if (Array.isArray(pa)) pa.push({ type: 'NAVIGATE', path: '/cart' });
        return JSON.stringify({ success: true, message: responseData.message });
      }
      return JSON.stringify({ success: false, message: responseData?.message || 'Failed to clear cart' });
    } catch (e) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
  {
    name: 'clear_cart',
    description: `Clears ALL items from the user's cart. This is irreversible — always confirm first.
Use when user says: 'clear my cart', 'empty cart', 'start over', 'remove everything from cart'.`,
    schema: z.object({}),
  }
);

// ----------------------payment tools------------------


// ─── 1. Create Payment Order ──────────────────────────────────────
const createPaymentOrderTool = tool(
  async ({ amount, referenceId }, config) => {
    try {
      const user = config?.configurable?.user;

      // Safely coerce amount — Groq may send as string or wrapped object
      const safeAmount = toNum(amount);
      if (!safeAmount || safeAmount <= 0) {
        return JSON.stringify({ success: false, message: 'Invalid amount. Please provide a valid amount in ₹.' });
      }

      const req = {
        user: { id: user?._id || user?.id || 'guest' },
        body: { amount: safeAmount, referenceId: referenceId || null },
        params: {},
        query: {},
      };
      const res = buildMockRes();
      await createPaymentOrderHandler(req, res);
      const { statusCode, responseData } = res.getData();

      if (statusCode === 200 && responseData?.success) {
        return JSON.stringify({
          success: true,
          order: responseData.order,   // { id, amount, currency }
          key: responseData.key,     // Razorpay key_id for frontend checkout
        });
      }

      // Gateway not configured → guide user to COD
      if (statusCode === 503) {
        return JSON.stringify({
          success: false,
          gatewayUnavailable: true,
          message: 'Online payment is not available right now. Please use Cash on Delivery (COD) instead.',
        });
      }

      return JSON.stringify({ success: false, message: responseData?.message || 'Failed to create payment order' });
    } catch (e) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
  {
    name: 'create_payment_order',
    description: `Creates a Razorpay payment order for online payment.
Use when user chooses to pay online / via UPI / card.
Call this AFTER the order is created and you have the total amount.
Returns a Razorpay order id and key needed to open the payment gateway.
If gateway is unavailable, suggest Cash on Delivery (COD) instead.
Amount must be in ₹ (rupees) — NOT paise. Example: 250 for ₹250.`,
    schema: z.object({
      amount: z.any().describe('Total payable amount in ₹ as a number. E.g. 250 for ₹250.'),
      referenceId: z.string().optional().describe('MongoDB _id of the associated order, if available'),
    }),
  }
);

// ─── 2. Verify Payment ────────────────────────────────────────────
const verifyPaymentTool = tool(
  async ({ razorpay_order_id, razorpay_payment_id, razorpay_signature }, config) => {
    try {
      const req = {
        user: config?.configurable?.user || null,
        body: { razorpay_order_id, razorpay_payment_id, razorpay_signature },
        params: {},
        query: {},
      };
      const res = buildMockRes();
      await verifyPaymentHandler(req, res);
      const { statusCode, responseData } = res.getData();

      if (statusCode === 200 && responseData?.success) {
        return JSON.stringify({
          success: true,
          message: 'Payment verified successfully.',
          paymentId: responseData.paymentId,
        });
      }

      return JSON.stringify({
        success: false,
        message: responseData?.message || 'Payment verification failed. The payment may be invalid or tampered.',
      });
    } catch (e) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
  {
    name: 'verify_payment',
    description: `Verifies a Razorpay payment after the user completes checkout.
Use when the frontend returns razorpay_order_id, razorpay_payment_id, and razorpay_signature
after a successful payment on the Razorpay checkout modal.
All three fields are required — never call this without all three.
Do NOT call this for COD orders.`,
    schema: z.object({
      razorpay_order_id: z.string().describe('Razorpay order ID returned from create_payment_order'),
      razorpay_payment_id: z.string().describe('Razorpay payment ID returned by checkout modal'),
      razorpay_signature: z.string().describe('Razorpay signature returned by checkout modal for HMAC verification'),
    }),
  }
);

// ─── 3. Get Payment Status ────────────────────────────────────────
const getPaymentStatusTool = tool(
  async ({ orderId }, config) => {
    try {
      const req = {
        user: config?.configurable?.user || null,
        body: {},
        params: { orderId },
        query: {},
      };
      const res = buildMockRes();
      await getPaymentStatusHandler(req, res);
      const { statusCode, responseData } = res.getData();

      if (statusCode === 200 && responseData?.success) {
        const p = responseData.payment;
        return JSON.stringify({
          success: true,
          payment: {
            orderId: p.orderId,
            paymentId: p.paymentId,
            amount: `₹${p.amount}`,
            status: p.status,           // CREATED | SUCCESS | FAILED
            createdAt: p.createdAt,
          },
        });
      }

      return JSON.stringify({ success: false, message: responseData?.message || 'Payment not found' });
    } catch (e) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
  {
    name: 'get_payment_status',
    description: `Fetches the status of a payment by its Razorpay order ID.
Use when user says: 'did my payment go through', 'check payment status', 'was I charged'.
Status will be one of: CREATED (pending), SUCCESS (paid), FAILED (declined).`,
    schema: z.object({
      orderId: z.string().describe('Razorpay order ID (starts with "order_") to check status for'),
    }),
  }
);

// ------------------Order Tools----------------------

// ─── 1. Place Order Tool ──────────────────────────────────────────
const placeOrderTool = tool(
  async ({ customerId, restaurantId, items, deliveryAddress, paymentMethod, pricing, razorpay_order_id }, config) => {
    const user = config?.configurable?.user;
    const req = {
      user: { id: user._id || user.id },
      body: { customerId, restaurantId, items, deliveryAddress, paymentMethod, pricing, razorpay_order_id },
      params: {},
      query: {}
    };
    const pa = config?.configurable?.pendingActions;
    const res = buildMockRes();
    await placeOrderHandler(req, res);
    const { statusCode, responseData } = res.getData();
    if (statusCode === 201 && responseData?.success) {
      // COD: navigate to orders list so user sees their new order
      if (Array.isArray(pa)) pa.push({ type: 'NAVIGATE', path: '/orders' });
      return JSON.stringify({ success: true, message: responseData.message, order: responseData.order });
    }
    return JSON.stringify({ success: false, message: responseData?.message || "Failed to place order" });
  },
  {
    name: "place_order",
    description: `Places a new food order for the authenticated user.
                  Use when user says: 'place my order', 'checkout', 'order this', 'confirm my order'.
                  Requires cart items, delivery address, payment method, and pricing details.`,
    schema: z.object({
      customerId: z.string().describe("MongoDB _id of the customer placing the order"),
      restaurantId: z.string().describe("MongoDB _id of the restaurant"),
      items: z.array(z.object({
        menuItem: z.string().describe("MongoDB _id of the menu item"),
        name: z.string(),
        price: z.any(),
        quantity: z.any(),
        customization: z.string().optional(),
      })).describe("Array of items in the order"),
      deliveryAddress: z.object({
        fullAddress: z.string(),
        latitude: z.any(),
        longitude: z.any(),
        street: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        zipCode: z.string().optional(),
        country: z.string().optional(),
        instructions: z.string().optional(),
      }).describe("Delivery address details"),
      paymentMethod: z.enum(["cod", "online"]).describe("Payment method: 'cod' for cash on delivery or 'online' for Razorpay"),
      pricing: z.object({
        subtotal: z.any(),
        deliveryFee: z.any(),
        platformFee: z.any(),
        gst: z.any(),
        totalAmount: z.any(),
      }).describe("Order pricing breakdown"),
      razorpay_order_id: z.string().optional().describe("Razorpay order ID if payment method is online"),
    }),
  }
);

// ─── 2. Get Customer Orders Tool ──────────────────────────────────
const getCustomerOrdersTool = tool(
  async ({ customerId }, config) => {
    const user = config?.configurable?.user;
    const pa = config?.configurable?.pendingActions;
    const req = {
      user: { id: user._id || user.id },
      body: {},
      params: { customerId },
      query: {}
    };
    const res = buildMockRes();
    await getCustomerOrdersHandler(req, res);
    const { statusCode, responseData } = res.getData();
    if (statusCode === 200 && responseData?.success) {
      if (Array.isArray(pa)) pa.push({ type: 'NAVIGATE', path: '/orders' });
      return JSON.stringify({ success: true, orders: responseData.orders });
    }
    return JSON.stringify({ success: false, message: responseData?.message || "Failed to fetch orders" });
  },
  {
    name: "get_customer_orders",
    description: `Fetches all orders for a specific customer, sorted by most recent first.
                  Use when user says: 'show my orders', 'order history', 'my past orders', 'what did I order'.`,
    schema: z.object({
      customerId: z.string().describe("MongoDB _id of the customer"),
    }),
  }
);

// ─── 3. Get Order By ID Tool ──────────────────────────────────────
const getOrderByIdTool = tool(
  async ({ orderId }, config) => {
    const user = config?.configurable?.user;
    const req = {
      user: { id: user._id || user.id },
      body: {},
      params: { id: orderId },
      query: {}
    };
    const res = buildMockRes();
    await getOrderByIdHandler(req, res);
    const { statusCode, responseData } = res.getData();
    if (statusCode === 200 && responseData?.success) {
      return JSON.stringify({ success: true, order: responseData.order });
    }
    return JSON.stringify({ success: false, message: responseData?.message || "Order not found" });
  },
  {
    name: "get_order_by_id",
    description: `Fetches detailed information about a specific order by its ID.
                  Use when user says: 'track my order', 'where is my order', 'order details', 'show order #123'.`,
    schema: z.object({
      orderId: z.string().describe("MongoDB _id of the order"),
    }),
  }
);

// ─── 4. Update Order Status Tool ──────────────────────────────────
const updateOrderStatusTool = tool(
  async ({ orderId, status }, config) => {
    const user = config?.configurable?.user;
    const req = {
      user: { id: user._id || user.id },
      body: { status },
      params: { id: orderId },
      query: {}
    };
    const res = buildMockRes();
    await updateOrderStatusHandler(req, res);
    const { statusCode, responseData } = res.getData();
    if (statusCode === 200 && responseData?.success) {
      return JSON.stringify({ success: true, message: responseData.message, order: responseData.order });
    }
    return JSON.stringify({ success: false, message: responseData?.message || "Failed to update status" });
  },
  {
    name: "update_order_status",
    description: `Updates the status of an order (restaurant/rider use).
                  Use when restaurant/rider says: 'mark order as preparing', 'order is ready', 'picked up the order'.
                  Valid statuses: preparing, ready, picked_up, on_the_way, delivered, cancelled.`,
    schema: z.object({
      orderId: z.string().describe("MongoDB _id of the order"),
      status: z.enum(["preparing", "ready", "picked_up", "on_the_way", "delivered", "cancelled"])
        .describe("New status for the order"),
    }),
  }
);

// ─── 5. Get Available Orders (Rider) Tool ─────────────────────────
const getAvailableOrdersTool = tool(
  async ({ latitude, longitude }, config) => {
    const user = config?.configurable?.user;
    const req = {
      user: { id: user._id || user.id },
      body: {},
      params: {},
      query: { latitude, longitude }
    };
    const res = buildMockRes();
    await getAvailableOrdersHandler(req, res);
    const { statusCode, responseData } = res.getData();
    if (statusCode === 200 && responseData?.success) {
      return JSON.stringify({ success: true, orders: responseData.orders });
    }
    return JSON.stringify({ success: false, message: responseData?.message || "Failed to fetch available orders" });
  },
  {
    name: "get_available_orders",
    description: `Fetches all orders awaiting rider assignment, filtered by distance from rider location.
                  Use when rider says: 'show available orders', 'what orders can I pick up', 'orders near me'.
                  Returns orders with status 'awaiting_rider' or 'accepted' that don't have a rider assigned yet.`,
    schema: z.object({
      latitude: z.any().optional().describe("Rider's current latitude"),
      longitude: z.any().optional().describe("Rider's current longitude"),
    }),
  }
);

// ─── 6. Rider Accept Order Tool ───────────────────────────────────
const riderAcceptOrderTool = tool(
  async ({ orderId, riderId }, config) => {
    const user = config?.configurable?.user;
    const req = {
      user: { id: user._id || user.id },
      body: { riderId },
      params: { id: orderId },
      query: {}
    };
    const res = buildMockRes();
    await riderAcceptOrderHandler(req, res);
    const { statusCode, responseData } = res.getData();
    if (statusCode === 200 && responseData?.success) {
      return JSON.stringify({ success: true, message: responseData.message, order: responseData.order });
    }
    return JSON.stringify({ success: false, message: responseData?.message || "Failed to accept order" });
  },
  {
    name: "rider_accept_order",
    description: `Allows a rider to accept an available order for delivery.
                  Use when rider says: 'accept this order', 'I'll take this delivery', 'assign this to me'.`,
    schema: z.object({
      orderId: z.string().describe("MongoDB _id of the order to accept"),
      riderId: z.string().describe("MongoDB _id of the rider accepting the order"),
    }),
  }
);

// ─── 7. Get Rider Orders Tool ─────────────────────────────────────
const getRiderOrdersTool = tool(
  async ({ riderId }, config) => {
    const user = config?.configurable?.user;
    const req = {
      user: { id: user._id || user.id },
      body: {},
      params: { riderId },
      query: {}
    };
    const res = buildMockRes();
    await getRiderOrdersHandler(req, res);
    const { statusCode, responseData } = res.getData();
    if (statusCode === 200 && responseData?.success) {
      return JSON.stringify({ success: true, orders: responseData.orders });
    }
    return JSON.stringify({ success: false, message: responseData?.message || "Failed to fetch rider orders" });
  },
  {
    name: "get_rider_orders",
    description: `Fetches all orders assigned to a specific rider.
                  Use when rider says: 'show my deliveries', 'my orders', 'what am I delivering'.`,
    schema: z.object({
      riderId: z.string().describe("MongoDB _id of the rider"),
    }),
  }
);

// ─── 8. Verify Pickup PIN Tool ────────────────────────────────────
const verifyPickupPinTool = tool(
  async ({ orderId, pin }, config) => {
    const user = config?.configurable?.user;
    const req = {
      user: { id: user._id || user.id },
      body: { pin },
      params: { id: orderId },
      query: {}
    };
    const res = buildMockRes();
    await verifyPickupPinHandler(req, res);
    const { statusCode, responseData } = res.getData();
    if (statusCode === 200 && responseData?.success) {
      return JSON.stringify({ success: true, message: responseData.message, order: responseData.order });
    }
    return JSON.stringify({ success: false, message: responseData?.message || "Invalid pickup PIN" });
  },
  {
    name: "verify_pickup_pin",
    description: `Verifies the pickup PIN before rider can mark order as picked up from restaurant.
                  Use when rider says: 'verify pickup PIN', 'enter pickup code', 'picked up order'.`,
    schema: z.object({
      orderId: z.string().describe("MongoDB _id of the order"),
      pin: z.string().describe("4-digit pickup PIN provided by restaurant"),
    }),
  }
);

// ─── 9. Verify Delivery PIN Tool ──────────────────────────────────
const verifyDeliveryPinTool = tool(
  async ({ orderId, pin }, config) => {
    const user = config?.configurable?.user;
    const req = {
      user: { id: user._id || user.id },
      body: { pin },
      params: { id: orderId },
      query: {}
    };
    const res = buildMockRes();
    await verifyDeliveryPinHandler(req, res);
    const { statusCode, responseData } = res.getData();
    if (statusCode === 200 && responseData?.success) {
      return JSON.stringify({ success: true, message: responseData.message, order: responseData.order });
    }
    return JSON.stringify({ success: false, message: responseData?.message || "Invalid delivery PIN" });
  },
  {
    name: "verify_delivery_pin",
    description: `Verifies the delivery PIN before marking order as delivered to customer.
                  Use when rider says: 'verify delivery PIN', 'enter delivery code', 'delivered order'.
                  This also updates rider earnings and statistics.`,
    schema: z.object({
      orderId: z.string().describe("MongoDB _id of the order"),
      pin: z.string().describe("4-digit delivery PIN provided by customer"),
    }),
  }
);

// ─── 10. Update Rider Location Tool ───────────────────────────────
const updateRiderLocationTool = tool(
  async ({ orderId, latitude, longitude }, config) => {
    const user = config?.configurable?.user;
    const req = {
      user: { id: user._id || user.id },
      body: { latitude, longitude },
      params: { id: orderId },
      query: {}
    };
    const res = buildMockRes();
    await updateRiderLocationHandler(req, res);
    const { statusCode, responseData } = res.getData();
    if (statusCode === 200 && responseData?.success) {
      return JSON.stringify({ success: true, message: responseData.message });
    }
    return JSON.stringify({ success: false, message: responseData?.message || "Failed to update location" });
  },
  {
    name: "update_rider_location",
    description: `Updates rider's current location for live order tracking.
                  Use when rider location changes during delivery for real-time customer tracking.`,
    schema: z.object({
      orderId: z.string().describe("MongoDB _id of the order being delivered"),
      latitude: z.any().describe("Rider's current latitude"),
      longitude: z.any().describe("Rider's current longitude"),
    }),
  }
);

// ─── Rider Profile Tools (from rider.js) ──────────────────────────

// ─── register_rider ───────────────────────────────────────────────
const registerRiderTool = tool(
  async ({ vehicleType, vehicleNumber, licenseNumber, aadharNumber, bankAccount, ifscCode }, config) => {
    try {
      const user = config?.configurable?.user;
      const req = {
        user: { id: user._id || user.id },
        body: { vehicleType, vehicleNumber, licenseNumber, aadharNumber, bankAccount, ifscCode },
        params: {}, query: {},
      };
      const res = buildMockRes();
      await registerRiderHandler(req, res);
      const { statusCode, responseData } = res.getData();
      if (statusCode === 200 && responseData?.success) {
        return JSON.stringify({ success: true, message: responseData.message, data: responseData.data });
      }
      return JSON.stringify({ success: false, message: responseData?.message || 'Registration failed' });
    } catch (e) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
  {
    name: 'register_rider',
    description: `Registers the current user as a rider. Requires vehicle and license details.
Use when user says: 'I want to become a rider', 'register me as rider', 'sign up as delivery partner'.
All fields are required — ask the user for any missing values before calling.`,
    schema: z.object({
      vehicleType: z.string().describe('Type of vehicle, e.g. Bike, Scooter, Bicycle'),
      vehicleNumber: z.string().describe('Vehicle registration number'),
      licenseNumber: z.string().describe('Driving license number'),
      aadharNumber: z.string().describe('Aadhar card number'),
      bankAccount: z.string().describe('Bank account number for earnings'),
      ifscCode: z.string().describe('IFSC code of the bank branch'),
    }),
  }
);

// ─── get_rider_stats ──────────────────────────────────────────────
const getRiderStatsTool = tool(
  async (_, config) => {
    try {
      const user = config?.configurable?.user;
      const pa = config?.configurable?.pendingActions;
      const req = { user: { id: user._id || user.id }, body: {}, params: {}, query: {} };
      const res = buildMockRes();
      await getRiderStatsHandler(req, res);
      const { statusCode, responseData } = res.getData();
      if (statusCode === 200 && responseData?.success) {
        if (Array.isArray(pa)) pa.push({ type: 'NAVIGATE', path: '/rider/dashboard' });
        return JSON.stringify({ success: true, data: responseData.data });
      }
      return JSON.stringify({ success: false, message: responseData?.message || 'Failed to fetch stats' });
    } catch (e) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
  {
    name: 'get_rider_stats',
    description: `Fetches the rider's performance statistics: total deliveries, earnings, today's earnings, rating, active orders.
No input needed. Use when rider says: 'show my stats', 'how much did I earn', 'my deliveries', 'my rating'.`,
    schema: z.object({}),
  }
);

// ─── toggle_rider_availability ────────────────────────────────────
const toggleRiderAvailabilityTool = tool(
  async ({ isAvailable }, config) => {
    try {
      const user = config?.configurable?.user;
      const req = {
        user: { id: user._id || user.id },
        body: { isAvailable: toBool(isAvailable) },
        params: {}, query: {},
      };
      const res = buildMockRes();
      await toggleRiderAvailabilityHandler(req, res);
      const { statusCode, responseData } = res.getData();
      if (statusCode === 200 && responseData?.success) {
        return JSON.stringify({ success: true, message: responseData.message });
      }
      return JSON.stringify({ success: false, message: responseData?.message || 'Failed to update availability' });
    } catch (e) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
  {
    name: 'toggle_rider_availability',
    description: `Toggles the rider's online/offline availability status.
Use when rider says: 'I am online', 'go online', 'go offline', 'I am not available', 'start accepting orders', 'stop taking orders'.
Pass isAvailable=true to go online, false to go offline.`,
    schema: z.object({
      isAvailable: z.any().describe('Boolean — true to go online, false to go offline'),
    }),
  }
);

// ─── update_rider_profile_location ───────────────────────────────
const updateRiderProfileLocationTool = tool(
  async ({ latitude, longitude }, config) => {
    try {
      const user = config?.configurable?.user;
      const req = {
        user: { id: user._id || user.id },
        body: { latitude: toNum(latitude), longitude: toNum(longitude) },
        params: {}, query: {},
      };
      const res = buildMockRes();
      await updateRiderProfileLocationHandler(req, res);
      const { statusCode, responseData } = res.getData();
      if (statusCode === 200 && responseData?.success) {
        return JSON.stringify({ success: true, message: 'Profile location updated' });
      }
      return JSON.stringify({ success: false, message: responseData?.message || 'Failed to update location' });
    } catch (e) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
  {
    name: 'update_rider_profile_location',
    description: `Updates the rider's saved current location in their profile (not tied to a specific order).
Use when rider says: 'update my location', 'set my current position'.`,
    schema: z.object({
      latitude: z.any().describe('Current latitude as a number'),
      longitude: z.any().describe('Current longitude as a number'),
    }),
  }
);

// ─── 11. Get Restaurant Orders Tool ───────────────────────────────
const getRestaurantOrdersTool = tool(
  async ({ restaurantId }, config) => {
    const user = config?.configurable?.user;
    const req = {
      user: { id: user._id || user.id },
      body: {},
      params: { restaurantId },
      query: {}
    };
    const res = buildMockRes();
    await getRestaurantOrdersHandler(req, res);
    const { statusCode, responseData } = res.getData();
    if (statusCode === 200 && responseData?.success) {
      return JSON.stringify({ success: true, orders: responseData.orders });
    }
    return JSON.stringify({ success: false, message: responseData?.message || "Failed to fetch restaurant orders" });
  },
  {
    name: "get_restaurant_orders",
    description: `Fetches all orders for a specific restaurant, limited to most recent 50.
                  Use when restaurant owner says: 'show my orders', 'incoming orders', 'order queue'.`,
    schema: z.object({
      restaurantId: z.string().describe("MongoDB _id of the restaurant"),
    }),
  }
);

// ─── 12. Create Pending Order Tool ────────────────────────────────
const createPendingOrderTool = tool(
  async ({ customerId, restaurantId, items, deliveryAddress, paymentMethod, pricing }, config) => {
    const user = config?.configurable?.user;
    const req = {
      user: { id: user._id || user.id },
      body: { customerId, restaurantId, items, deliveryAddress, paymentMethod, pricing },
      params: {},
      query: {}
    };
    const res = buildMockRes();
    await createPendingOrderHandler(req, res);
    const { statusCode, responseData } = res.getData();
    if (statusCode === 201 && responseData?.success) {
      return JSON.stringify({ success: true, order: responseData.order });
    }
    return JSON.stringify({ success: false, message: responseData?.message || "Failed to create pending order" });
  },
  {
    name: "create_pending_order",
    description: `Creates a pending order before payment is initiated (internal use for payment flow).
                  Use this before initiating Razorpay payment for online orders.`,
    schema: z.object({
      customerId: z.string(),
      restaurantId: z.string(),
      items: z.array(z.object({
        menuItem: z.string(),
        name: z.string(),
        price: z.any(),
        quantity: z.any(),
        customization: z.string().optional(),
      })),
      deliveryAddress: z.object({
        fullAddress: z.string(),
        latitude: z.any(),
        longitude: z.any(),
      }),
      paymentMethod: z.enum(["cod", "online"]),
      pricing: z.object({
        subtotal: z.any(),
        deliveryFee: z.any(),
        platformFee: z.any(),
        gst: z.any(),
        totalAmount: z.any(),
      }),
    }),
  }
);

// ─── 13. Confirm Order After Payment Tool ─────────────────────────
const confirmOrderTool = tool(
  async ({ orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature }, config) => {
    const user = config?.configurable?.user;
    const req = {
      user: { id: user._id || user.id },
      body: { razorpay_order_id, razorpay_payment_id, razorpay_signature },
      params: { orderId },
      query: {}
    };
    const pa = config?.configurable?.pendingActions;
    const res = buildMockRes();
    await confirmOrderHandler(req, res);
    const { statusCode, responseData } = res.getData();
    if (statusCode === 200 && responseData?.success) {
      // Navigate to live tracking page for this specific order
      if (Array.isArray(pa)) pa.push({ type: 'NAVIGATE', path: `/track-order/${orderId}` });
      return JSON.stringify({ success: true, order: responseData.order });
    }
    return JSON.stringify({ success: false, message: responseData?.message || "Failed to confirm order" });
  },
  {
    name: "confirm_order_after_payment",
    description: `Confirms a pending order after successful Razorpay payment verification.
                  Use after payment webhook confirms payment was successful.`,
    schema: z.object({
      orderId: z.string().describe("MongoDB _id of the pending order"),
      razorpay_order_id: z.string().describe("Razorpay order ID"),
      razorpay_payment_id: z.string().describe("Razorpay payment ID"),
      razorpay_signature: z.string().describe("Razorpay signature for verification"),
    }),
  }
);
// ─── Frontend Action Tools ───────────────────────────────────────

// ─── navigate_to ─────────────────────────────────────────────────
const navigateToTool = tool(
  async ({ path }, config) => {
    const pa = config?.configurable?.pendingActions;
    if (Array.isArray(pa)) pa.push({ type: 'NAVIGATE', path });
    return JSON.stringify({ success: true, message: `Navigation to ${path} queued.` });
  },
  {
    name: 'navigate_to',
    description: `Navigates the user's browser to a page in the BigBite app without a page refresh.
Only call this for explicit user intent navigation (see NAVIGATION RULES section B).

ALL VALID PATHS (from App.jsx):
  '/'                                        →  Home — restaurant list, food discovery
  '/restaurant/:restaurantId'                →  Restaurant page with full menu (use real _id)
  '/restaurant/:restaurantId/item/:itemId'   →  Specific menu item detail
  '/cart'                                    →  Cart page
  '/orders'                                  →  My orders list
  '/track-order/:orderId'                    →  Live order tracking (use real _id)
  '/profile'                                 →  User profile & settings
  '/wishlists'                               →  Wishlists manager
  '/restaurant-dashboard'                    →  Restaurant owner dashboard
  '/restaurant-registration'                 →  Restaurant signup
  '/rider/dashboard'                         →  Rider dashboard
  '/rider-registration'                      →  Rider signup
  '/about'                                   →  About BigBite
  '/privacy-policy'                          →  Privacy policy

IMPORTANT: Replace :restaurantId and :orderId with actual MongoDB _id hex strings. Never pass names.`,
    schema: z.object({
      path: z.string().describe("Exact route path, e.g. '/' or '/restaurant/693ac398e20be2541c4735d5' or '/track-order/abc123'"),
    }),
  }
);

// ─── refresh_cart_ui ─────────────────────────────────────────────
const refreshCartUiTool = tool(
  async (_, config) => {
    const pa = config?.configurable?.pendingActions;
    if (Array.isArray(pa)) pa.push({ type: 'CLEAR_CART' });
    return JSON.stringify({ success: true, message: 'Frontend cart UI will be cleared.' });
  },
  {
    name: 'refresh_cart_ui',
    description: `Clears the cart display on the frontend. Call after order is placed so the user sees an empty cart. Does NOT delete DB data — use clear_cart for that.`,
    schema: z.object({}),
  }
);

// ─── initiate_online_payment ──────────────────────────────────────
const initiateOnlinePaymentTool = tool(
  async ({ orderId, totalAmount }, config) => {
    try {
      const safeAmount = toNum(totalAmount);
      if (!safeAmount || safeAmount <= 0)
        return JSON.stringify({ success: false, message: 'Invalid totalAmount. Must be a positive number in ₹.' });

      const approvedSiteUrl = 'https://bharat-kumar-19030.github.io/Learno-Hub/payment.html';
      const backendUrl = process.env.SERVER_URL || process.env.BACKEND_URL || 'http://localhost:5000';
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

      const paymentData = {
        amount: safeAmount,
        ref: orderId,
        returnUrl: `${frontendUrl}/payment-callback`,
        timestamp: Date.now(),
      };

      const encryptedData = encryptPaymentDataBackend(paymentData);
      const paymentUrl = `${approvedSiteUrl}?data=${encodeURIComponent(encryptedData)}&backend=${encodeURIComponent(backendUrl)}`;

      const pa = config?.configurable?.pendingActions;
      if (Array.isArray(pa)) pa.push({ type: 'OPEN_PAYMENT_TAB', paymentUrl });

      return JSON.stringify({
        success: true,
        message: 'Payment tab action queued. The user will see the Razorpay payment page open in a new browser tab. WAIT for a PAYMENT_RESULT message — do not call any more tools until you receive it.',
      });
    } catch (e) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
  {
    name: 'initiate_online_payment',
    description: `Opens the Razorpay payment page in a new browser tab for the user.
Call ONLY after create_pending_order has returned a valid orderId.
Provide the orderId and totalAmount in ₹.
After calling this, WAIT — do not call any more tools.
The frontend will automatically send a PAYMENT_RESULT message when the user finishes or cancels payment.`,
    schema: z.object({
      orderId: z.string().describe('MongoDB _id returned by create_pending_order'),
      totalAmount: z.any().describe('Total payable amount in ₹'),
    }),
  }
);

// ─── Auth Tools ───────────────────────────────────────────────────

// ─── get_me ──────────────────────────────────────────────────────
const getMeTool = tool(
  async (_, config) => {
    try {
      const user = config?.configurable?.user;
      const pa = config?.configurable?.pendingActions;
      const req = { user: { id: user._id || user.id }, body: {}, params: {}, query: {} };
      const res = buildMockRes();
      await getMeHandler(req, res);
      const { statusCode, responseData } = res.getData();
      if (statusCode === 200 && responseData?.success) {
        // NOTE: No auto-navigate here — get_me is called internally during order flows.
        // Navigation to /profile only happens via navigate_to when user explicitly asks for their profile.
        return JSON.stringify({ success: true, user: responseData.user });
      }
      return JSON.stringify({ success: false, message: responseData?.message || 'Failed to fetch profile' });
    } catch (e) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
  {
    name: 'get_me',
    description: `Fetches the full profile of the currently logged-in user.
No input needed. Use when user says: 'show my profile', 'what is my name/email/address', 'my account details', 'who am I logged in as'.`,
    schema: z.object({}),
  }
);

// ─── update_profile ───────────────────────────────────────────────
const updateProfileTool = tool(
  async ({ name, phone, avatar, address, restaurantDetails, riderDetails }, config) => {
    try {
      const user = config?.configurable?.user;
      const body = {};
      if (name !== undefined) body.name = name;
      if (phone !== undefined) body.phone = phone;
      if (avatar !== undefined) body.avatar = avatar;
      if (address !== undefined) body.address = address;
      if (restaurantDetails !== undefined) body.restaurantDetails = restaurantDetails;
      if (riderDetails !== undefined) body.riderDetails = riderDetails;
      const req = { user: { id: user._id || user.id }, body, params: {}, query: {} };
      const res = buildMockRes();
      await updateProfileHandler(req, res);
      const { statusCode, responseData } = res.getData();
      if (statusCode === 200 && responseData?.success) {
        return JSON.stringify({ success: true, message: 'Profile updated successfully.', user: responseData.user });
      }
      return JSON.stringify({ success: false, message: responseData?.message || 'Failed to update profile' });
    } catch (e) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
  {
    name: 'update_profile',
    description: `Updates the logged-in user's profile. Only pass fields that need changing — all are optional.
Use when user says: 'change my name', 'update my phone', 'set my address', 'change avatar'.
For address provide: street, city, state, zipCode, country, latitude, longitude.
Do NOT change email or password via this tool.`,
    schema: z.object({
      name: z.string().optional().describe('New display name'),
      phone: z.string().optional().describe('10-digit mobile number'),
      avatar: z.string().optional().describe('URL of new avatar image'),
      address: z.object({
        street: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        zipCode: z.string().optional(),
        country: z.string().optional(),
        latitude: z.any().optional(),
        longitude: z.any().optional(),
      }).optional().describe('Delivery address'),
      restaurantDetails: z.object({
        kitchenName: z.string().optional(),
        cuisine: z.array(z.string()).optional(),
        description: z.string().optional(),
        address: z.object({
          street: z.string().optional(), city: z.string().optional(),
          state: z.string().optional(), zipCode: z.string().optional(),
          country: z.string().optional(), latitude: z.any().optional(), longitude: z.any().optional(),
        }).optional(),
      }).optional().describe('Restaurant details — restaurant-role users only'),
      riderDetails: z.object({
        vehicleType: z.string().optional(),
        vehicleNumber: z.string().optional(),
        licenseNumber: z.string().optional(),
      }).optional().describe('Rider details — rider-role users only'),
    }),
  }
);

// ─── logout ───────────────────────────────────────────────────────
const logoutTool = tool(
  async (_, config) => {
    try {
      const user = config?.configurable?.user;
      const req = { user: { id: user._id || user.id }, body: {}, params: {}, query: {} };
      const res = buildMockRes();
      await logoutHandler(req, res);
      const { statusCode, responseData } = res.getData();
      // Push LOGOUT action so the frontend clears the auth session
      const pa = config?.configurable?.pendingActions;
      if (Array.isArray(pa)) pa.push({ type: 'LOGOUT' });
      if (statusCode === 200 && responseData?.success) {
        return JSON.stringify({ success: true, message: 'Logged out successfully.' });
      }
      return JSON.stringify({ success: false, message: responseData?.message || 'Logout failed' });
    } catch (e) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
  {
    name: 'logout',
    description: `Logs the user out of their BigBite session.
ALWAYS confirm with the user before calling — it cannot be undone without re-login.
Use when user says: 'log me out', 'sign out', 'logout'.`,
    schema: z.object({}),
  }
);

// ─── Restaurant Tools ─────────────────────────────────────────────

// ─── Numeric helper — handles string/number/{type,value} from any Groq model ──
function toNum(val, fallback = null) {
  if (val == null) return fallback;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') { const n = parseFloat(val); return isNaN(n) ? fallback : n; }
  if (typeof val === 'object' && 'value' in val) return Number(val.value);
  return fallback;
}

// ─── 1. Get Menu Items ────────────────────────────────────────────
const getMenuItemsTool = tool(
  async (_, config) => {
    try {
      const user = config?.configurable?.user;
      const req = {
        user: { _id: user._id || user.id, role: user.role },
        body: {}, params: {}, query: {},
      };
      const res = buildMockRes();
      await getMenuItemsHandler(req, res);
      const { statusCode, responseData } = res.getData();
      if (statusCode === 200 && responseData?.success) {
        return JSON.stringify({ success: true, count: responseData.count, data: responseData.data });
      }
      return JSON.stringify({ success: false, message: responseData?.message || "Failed to fetch menu items" });
    } catch (e) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
  {
    name: "get_menu_items",
    description: `Fetches all menu items for the authenticated restaurant owner.
No input needed. Use when restaurant owner says:
'show my menu', 'what items do I have', 'list my dishes', 'view my menu'.`,
    schema: z.object({}),
  }
);

// ─── 2. Create Menu Item ──────────────────────────────────────────
const createMenuItemTool = tool(
  async ({ name, description, price, category, cuisine, subCategory, image, isVeg, isAvailable }, config) => {
    try {
      const user = config?.configurable?.user;
      const req = {
        user: { _id: user._id || user.id, role: user.role },
        body: {
          name,
          description,
          price: toNum(price),
          category,
          cuisine,
          subCategory,
          image,
          isVeg: toBool(isVeg, true),
          isAvailable: toBool(isAvailable, true),
        },
        params: {}, query: {},
      };
      const res = buildMockRes();
      await createMenuItemHandler(req, res);
      const { statusCode, responseData } = res.getData();
      if (statusCode === 201 && responseData?.success) {
        return JSON.stringify({ success: true, message: "Menu item created", data: responseData.data });
      }
      return JSON.stringify({ success: false, message: responseData?.message || "Failed to create menu item" });
    } catch (e) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
  {
    name: "create_menu_item",
    description: `Creates a new menu item for the restaurant owner.
Use when restaurant owner says: 'add a new dish', 'create menu item', 'add item to my menu'.
Required: name, description, price, category, cuisine, image.
Category must be one of: Starter, Main Course, Dessert, Beverage, Snacks.
Cuisine must be one of: Indian, Chinese, Italian, Mexican, Thai, Japanese, French, Mediterranean, American, Korean, Middle Eastern, Continental.`,
    schema: z.object({
      name: z.string().describe("Name of the dish"),
      description: z.string().describe("Description of the dish"),
      price: z.any().describe("Price in ₹ as a number"),
      category: z.string().describe("One of: Starter, Main Course, Dessert, Beverage, Snacks"),
      cuisine: z.string().describe("One of: Indian, Chinese, Italian, Mexican, Thai, Japanese, French, Mediterranean, American, Korean, Middle Eastern, Continental"),
      subCategory: z.string().optional().describe("Optional sub-category"),
      image: z.string().describe("Image URL for the dish"),
      isVeg: z.any().optional().describe("Boolean — pass true or false (not a string)"),
      isAvailable: z.any().optional().describe("Boolean — pass true or false (not a string)"),
    }),
  }
);

// ─── 3. Update Menu Item ──────────────────────────────────────────
const updateMenuItemTool = tool(
  async ({ menuItemId, name, description, price, category, cuisine, subCategory, image, isVeg, isAvailable }, config) => {
    try {
      const user = config?.configurable?.user;
      const body = {};
      if (name !== undefined) body.name = name;
      if (description !== undefined) body.description = description;
      if (price !== undefined) body.price = toNum(price);
      if (category !== undefined) body.category = category;
      if (cuisine !== undefined) body.cuisine = cuisine;
      if (subCategory !== undefined) body.subCategory = subCategory;
      if (image !== undefined) body.image = image;
      if (isVeg !== undefined) body.isVeg = toBool(isVeg, true);
      if (isAvailable !== undefined) body.isAvailable = toBool(isAvailable, true);

      const req = {
        user: { _id: user._id || user.id, role: user.role },
        body,
        params: { id: menuItemId },
        query: {},
      };
      const res = buildMockRes();
      await updateMenuItemHandler(req, res);
      const { statusCode, responseData } = res.getData();
      if (statusCode === 200 && responseData?.success) {
        return JSON.stringify({ success: true, message: "Menu item updated", data: responseData.data });
      }
      return JSON.stringify({ success: false, message: responseData?.message || "Failed to update menu item" });
    } catch (e) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
  {
    name: "update_menu_item",
    description: `Updates an existing menu item for the restaurant owner.
Use when restaurant owner says: 'edit dish', 'change price', 'update menu item', 'mark item unavailable'.
Only pass fields that need updating — all fields are optional except menuItemId.`,
    schema: z.object({
      menuItemId: z.string().describe("MongoDB _id of the menu item to update"),
      name: z.string().optional(),
      description: z.string().optional(),
      price: z.any().optional().describe("New price in ₹"),
      category: z.string().optional(),
      cuisine: z.string().optional(),
      subCategory: z.string().optional(),
      image: z.string().optional(),
      isVeg: z.any().optional().describe("Boolean — pass true or false (not a string)"),
      isAvailable: z.any().optional().describe("Boolean — pass true or false (not a string)"),
    }),
  }
);

// ─── 4. Delete Menu Item ──────────────────────────────────────────
const deleteMenuItemTool = tool(
  async ({ menuItemId }, config) => {
    try {
      const user = config?.configurable?.user;
      const req = {
        user: { _id: user._id || user.id, role: user.role },
        body: {},
        params: { id: menuItemId },
        query: {},
      };
      const res = buildMockRes();
      await deleteMenuItemHandler(req, res);
      const { statusCode, responseData } = res.getData();
      if (statusCode === 200 && responseData?.success) {
        return JSON.stringify({ success: true, message: "Menu item deleted successfully" });
      }
      return JSON.stringify({ success: false, message: responseData?.message || "Failed to delete menu item" });
    } catch (e) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
  {
    name: "delete_menu_item",
    description: `Permanently deletes a menu item. ALWAYS confirm with owner before calling.
Use when restaurant owner says: 'delete dish', 'remove item from menu', 'delete this item'.`,
    schema: z.object({
      menuItemId: z.string().describe("MongoDB _id of the menu item to delete"),
    }),
  }
);

// ─── 5. Toggle Kitchen ────────────────────────────────────────────
const toggleKitchenTool = tool(
  async (_, config) => {
    try {
      const user = config?.configurable?.user;
      const req = {
        user: { _id: user._id || user.id, role: user.role },
        body: {}, params: {}, query: {},
      };
      const res = buildMockRes();
      await toggleKitchenHandler(req, res);
      const { statusCode, responseData } = res.getData();
      if (statusCode === 200 && responseData?.success) {
        return JSON.stringify({
          success: true,
          message: responseData.message,
          isKitchenOpen: responseData.isKitchenOpen,
        });
      }
      return JSON.stringify({ success: false, message: responseData?.message || "Failed to toggle kitchen" });
    } catch (e) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
  {
    name: "toggle_kitchen",
    description: `Toggles kitchen open/close status for the restaurant owner.
Use when owner says: 'open my kitchen', 'close the kitchen', 'pause orders', 'stop taking orders'.
WARN owner before closing: kitchen cannot close if there are active orders.`,
    schema: z.object({}),
  }
);

// ─── 6. Get All Restaurants ───────────────────────────────────────
const getAllRestaurantsTool = tool(
  async ({ latitude, longitude, maxDistance }, config) => {
    try {
      const user = config?.configurable?.user;

      // Step 1: prefer user's saved address
      let lat = user?.address?.latitude;
      let lng = user?.address?.longitude;

      // Step 2: fallback to args (safely unwrap any format Groq sends)
      if (lat == null || lng == null) {
        lat = toNum(latitude);
        lng = toNum(longitude);
      }

      const distance = toNum(maxDistance) ?? 25;

      console.log("📍 getAllRestaurants coords:", { lat, lng, distance });

      // Step 3: still missing — signal LLM to ask user
      if (lat == null || lng == null) {
        return JSON.stringify({
          success: false,
          requiresLocation: true,
          message: "User location is missing. Please ask the user for their city or coordinates before retrying.",
        });
      }

      const req = {
        user: user || null,
        body: {},
        params: {},
        query: {
          latitude: String(lat),
          longitude: String(lng),
          maxDistance: String(distance),
        },
      };

      const res = buildMockRes();
      await getAllRestaurantsHandler(req, res);
      const { statusCode, responseData } = res.getData();

      if (statusCode === 200 && responseData?.success) {
        const pa = config?.configurable?.pendingActions;
        // ✅ Trim menuItems to avoid massive token usage — send names/prices only
        const trimmed = responseData.data.map(r => ({
          id: r.id,
          name: r.name,
          cuisine: r.cuisine,
          isKitchenOpen: r.isKitchenOpen,
          rating: r.restaurantDetails?.rating,
          menuItems: r.menuItems.map(m => ({
            _id: m._id,
            name: m.name,
            price: m.price,
            category: m.category,
            isVeg: m.isVeg,
          })),
        }));

        // ─── Smart navigation: if the user queried a specific restaurant
        // (e.g. "what does Burger King have" / "what does kitchen ette have"),
        // navigate directly to that restaurant's page.
        // Uses multi-strategy fuzzy matching so typos, extra spaces, and
        // camelCase names all resolve correctly.
        if (Array.isArray(pa)) {
          const userMsg = (config?.configurable?.lastUserInput || '').toLowerCase();

          /**
           * Compute a match score between the user's message and a restaurant name.
           * Returns a number in [0, 1]:  1.0 = perfect match, 0 = no match.
           *
           * Strategies (tried in order of confidence):
           *  1. Exact substring  - "kitchenette foods" appears verbatim
           *  2. Spaces-stripped  - "kitchettefoods" matches after removing spaces
           *  2b. Per-token noSpace - each token checked in space-stripped msg
           *  3. Word overlap     - fraction of name-words found in the message
           *  4. Jaro fuzzy       - catches single-char typos ("kithenette" ~ "kitchenette")
           */
          function restaurantMatchScore(rName, msg) {
            if (!rName || !msg) return 0;
            const nameLower = rName.toLowerCase();
            const nameTokens = nameLower.split(/\s+/).filter(Boolean);

            // Strategy 1: exact substring
            if (msg.includes(nameLower)) return 1.0;

            // Strategy 2: full name with all spaces stripped
            const nameNoSpace = nameLower.replace(/\s+/g, '');
            const msgNoSpace = msg.replace(/\s+/g, '');
            if (nameNoSpace.length > 3 && msgNoSpace.includes(nameNoSpace)) return 0.95;

            // Strategy 2b: each significant name token in space-stripped message.
            // Only return early if the score meets the threshold - otherwise fall
            // through so Strategy 3/4 can still rescue a partial match.
            const tokenMatchesNoSpace = nameTokens.filter(tok => tok.length > 3 && msgNoSpace.includes(tok));
            const noSpaceScore = 0.85 * (tokenMatchesNoSpace.length / nameTokens.length);
            if (tokenMatchesNoSpace.length >= Math.ceil(nameTokens.length / 2) && noSpaceScore >= 0.5) {
              return noSpaceScore;
            }

            // Strategy 3: word-overlap (normal msg OR space-stripped)
            const matchedWords = nameTokens.filter(tok =>
              tok.length > 2 && (msg.includes(tok) || msgNoSpace.includes(tok))
            );
            const overlapRatio = matchedWords.length / nameTokens.length;
            if (overlapRatio >= 0.5) return overlapRatio;

            // Strategy 4: Jaro fuzzy - catches typos like "kithenette" vs "kitchenette"
            // (Jaro similarity ~0.97, well above 0.88 threshold). No external deps.
            const userWords = msg.split(/[\s,!?.]+/).filter(w => w.length > 3);
            const fuzzyMatched = nameTokens.filter(tok => {
              if (tok.length <= 3) return false;
              return userWords.some(w => {
                if (tok === w) return true;
                const sl = tok.length, tl = w.length;
                const md = Math.floor(Math.max(sl, tl) / 2) - 1;
                if (md < 0) return false;
                const sm = new Array(sl).fill(false), tm = new Array(tl).fill(false);
                let m = 0;
                for (let i = 0; i < sl; i++) {
                  for (let j = Math.max(0, i - md); j < Math.min(i + md + 1, tl); j++) {
                    if (tm[j] || tok[i] !== w[j]) continue;
                    sm[i] = tm[j] = true; m++; break;
                  }
                }
                if (!m) return false;
                let k = 0, tr = 0;
                for (let i = 0; i < sl; i++) {
                  if (!sm[i]) continue;
                  while (!tm[k]) k++;
                  if (tok[i] !== w[k]) tr++;
                  k++;
                }
                return (m / sl + m / tl + (m - tr / 2) / m) / 3 >= 0.88;
              });
            });
            const fuzzyRatio = fuzzyMatched.length / nameTokens.length;
            return fuzzyRatio >= 0.5 ? 0.75 * fuzzyRatio : 0;
          }

          let bestMatch = null;
          let bestScore = 0;
          const MATCH_THRESHOLD = 0.5; // at least 50% word overlap required

          for (const r of trimmed) {
            const score = restaurantMatchScore(r.name, userMsg);
            if (score > bestScore) { bestScore = score; bestMatch = r; }
          }

          // Only a single restaurant returned → almost certainly the right one
          const singleResult = trimmed.length === 1 ? trimmed[0] : null;

          const matched = singleResult ?? (bestScore >= MATCH_THRESHOLD ? bestMatch : null);

          if (matched?.id) {
            console.log(`🗺️ Smart nav → /restaurant/${matched.id} (name: "${matched.name}", score: ${bestScore.toFixed(2)})`);
            pa.push({ type: 'NAVIGATE', path: `/restaurant/${matched.id}` });
          } else {
            pa.push({ type: 'NAVIGATE', path: '/' });
          }
        }

        return JSON.stringify({ success: true, count: trimmed.length, data: trimmed });
      }

      return JSON.stringify({ success: false, message: responseData?.message || "Failed to fetch restaurants" });
    } catch (e) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
  {
    name: "get_all_restaurants",
    description: `Fetches nearby restaurants and their menus using the user's location.
Priority for location:
1. User's saved address from context (auto-used, no need to pass)
2. latitude/longitude args if provided by user
3. If no location available — ask user for their city/area first

Use when user says: 'restaurants near me', 'what can I order', 'suggest me food',
'do you have X dish', 'show nearby restaurants', 'suggest something sweet/spicy'.

ALSO use this tool (not get_menu_items) when a CUSTOMER asks about a specific restaurant's menu:
- 'what does [restaurant name] have'
- 'what all menu [restaurant name] has'
- 'show menu of [restaurant name]'
- 'what can I order from [restaurant name]'
- 'what food does [restaurant name] serve'
This tool will automatically navigate the frontend to that restaurant's page.`,
    schema: z.object({
      latitude: z.any().optional().describe("User latitude as a number — leave empty if unknown"),
      longitude: z.any().optional().describe("User longitude as a number — leave empty if unknown"),
      maxDistance: z.any().optional().describe("Search radius in km, default 25"),
    }),
  }
);

// ─── Reusable mock res builder ────────────────────────────────────
function buildMockRes() {
  let responseData = null;
  let statusCode = 200;
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { responseData = data; return this; },
    getData() { return { statusCode, responseData }; }
  };
  return res;
}

// ─── Wishlist Tools ───────────────────────────────────────────────

const getWishlistsTool = tool(
  async (_, config) => {
    const user = config?.configurable?.user;
    const pa = config?.configurable?.pendingActions;
    const req = { user: { id: user._id || user.id }, body: {}, params: {}, query: {} };
    const res = buildMockRes();
    await getWishlistsHandler(req, res);
    const { statusCode, responseData } = res.getData();
    if (statusCode === 200 && responseData?.success) {
      if (Array.isArray(pa)) pa.push({ type: 'NAVIGATE', path: '/wishlists' });
      return JSON.stringify({ success: true, count: responseData.count, wishlists: responseData.wishlists });
    }
    return JSON.stringify({ success: false, message: responseData?.message || "Failed to fetch wishlists" });
  },
  {
    name: "get_wishlists",
    description: `Fetches all wishlists of the authenticated user.
                  No input needed. Use when user says:
                  'show my wishlists', 'what is in my wishlist', 'get my saved items'.`,
    schema: z.object({}),
  }
);

const getWishlistByIdTool = tool(
  async ({ wishlistId }, config) => {
    const user = config?.configurable?.user;
    const req = { user: { id: user._id || user.id }, body: {}, params: { id: wishlistId }, query: {} };
    const res = buildMockRes();
    await getWishlistByIdHandler(req, res);
    const { statusCode, responseData } = res.getData();
    if (statusCode === 200 && responseData?.success) {
      return JSON.stringify({ success: true, wishlist: responseData.wishlist });
    }
    return JSON.stringify({ success: false, message: responseData?.message || "Wishlist not found" });
  },
  {
    name: "get_wishlist_by_id",
    description: `Fetches a single wishlist by its ID. Use when user says: 'open wishlist', 'show a specific wishlist'.`,
    schema: z.object({
      wishlistId: z.string().describe("The MongoDB _id of the wishlist to fetch"),
    }),
  }
);

const createWishlistTool = tool(
  async ({ name, restaurant, items }, config) => {
    // Guard: restaurant must be a valid ObjectId (24-char hex), not a name string
    if (!restaurant || !/^[a-fA-F0-9]{24}$/.test(restaurant)) {
      return JSON.stringify({
        success: false,
        message: `Invalid restaurantId "${restaurant}". You must pass the MongoDB _id (24-character hex) from get_all_restaurants, NOT the restaurant name.`,
      });
    }
    const user = config?.configurable?.user;
    const req = { user: { id: user._id || user.id }, body: { name, restaurant, items }, params: {}, query: {} };
    const res = buildMockRes();
    await createWishlistHandler(req, res);
    const { statusCode, responseData } = res.getData();
    if (statusCode === 201 && responseData?.success) {
      return JSON.stringify({ success: true, message: "Wishlist created", wishlist: responseData.wishlist });
    }
    return JSON.stringify({ success: false, message: responseData?.message || "Failed to create wishlist" });
  },
  {
    name: "create_wishlist",
    description: `Creates a new empty wishlist for a specific restaurant.
Use when user says: 'create a wishlist', 'save these items', 'make a new wishlist'.
IMPORTANT: 'restaurant' MUST be the MongoDB _id (e.g. "693ac398e20be2541c4735d5") from get_all_restaurants — NEVER the restaurant name string.`,
    schema: z.object({
      name: z.string().describe("Human-readable name for the wishlist, e.g. 'Favourites'"),
      restaurant: z.string().describe("MongoDB _id of the restaurant — 24-char hex from get_all_restaurants. NEVER pass the restaurant name here."),
      items: z.array(z.object({
        menuItem: z.string().describe("MongoDB _id of the menu item"),
        name: z.string().describe("Name of the item"),
        price: z.any().describe("Price in ₹"),
        quantity: z.any().describe("Quantity of the item default 1"),
      })).optional().describe("Initial items — can be empty []"),
    }),
  }
);

const addItemToWishlistTool = tool(
  async ({ wishlistId, menuItem, name, price, quantity }, config) => {
    const user = config?.configurable?.user;
    const req = {
      user: { id: user._id || user.id },
      body: { menuItem, name, price, quantity },
      params: { id: wishlistId },
      query: {}
    };
    const res = buildMockRes();
    await addItemToWishlistHandler(req, res);
    const { statusCode, responseData } = res.getData();
    if (statusCode === 200 && responseData?.success) {
      return JSON.stringify({ success: true, message: "Item added", wishlist: responseData.wishlist });
    }
    return JSON.stringify({ success: false, message: responseData?.message || "Failed to add item" });
  },
  {
    name: "add_item_to_wishlist",
    description: `Adds a menu item to an existing wishlist. Use when user says: 'add to wishlist', 'save this dish'.`,
    schema: z.object({
      wishlistId: z.string().describe("The _id of the wishlist"),
      menuItem: z.string().describe("The _id of the menu item"),
      name: z.string().describe("Name of the item"),
      price: z.any().describe("Price in ₹"),
      quantity: z.any().describe("Quantity of the item default 1"),
    }),
  }
);

const removeItemFromWishlistTool = tool(
  async ({ wishlistId, itemId }, config) => {
    const user = config?.configurable?.user;
    const req = { user: { id: user._id || user.id }, body: {}, params: { id: wishlistId, itemId }, query: {} };
    const res = buildMockRes();
    await removeItemFromWishlistHandler(req, res);
    const { statusCode, responseData } = res.getData();
    if (statusCode === 200 && responseData?.success) {
      return JSON.stringify({ success: true, message: "Item removed" });
    }
    return JSON.stringify({ success: false, message: responseData?.message || "Failed to remove item" });
  },
  {
    name: "remove_item_from_wishlist",
    description: `Removes an item from a wishlist. Use when user says: 'remove from wishlist', 'delete saved item'.`,
    schema: z.object({
      wishlistId: z.string().describe("The _id of the wishlist"),
      itemId: z.string().describe("The _id of the item inside the wishlist"),
    }),
  }
);

const deleteWishlistTool = tool(
  async ({ wishlistId }, config) => {
    const user = config?.configurable?.user;
    const req = { user: { id: user._id || user.id }, body: {}, params: { id: wishlistId }, query: {} };
    const res = buildMockRes();
    await deleteWishlistHandler(req, res);
    const { statusCode, responseData } = res.getData();
    if (statusCode === 200 && responseData?.success) {
      return JSON.stringify({ success: true, message: "Wishlist deleted" });
    }
    return JSON.stringify({ success: false, message: responseData?.message || "Failed to delete wishlist" });
  },
  {
    name: "delete_wishlist",
    description: `Deletes an entire wishlist. Use when user says: 'delete wishlist', 'remove this saved list'.`,
    schema: z.object({
      wishlistId: z.string().describe("The _id of the wishlist to delete"),
    }),
  }
);

const updateWishlistNameTool = tool(
  async ({ wishlistId, name }, config) => {
    const user = config?.configurable?.user;
    const req = { user: { id: user._id || user.id }, body: { name }, params: { id: wishlistId }, query: {} };
    const res = buildMockRes();
    await updateWishlistNameHandler(req, res);
    const { statusCode, responseData } = res.getData();
    if (statusCode === 200 && responseData?.success) {
      return JSON.stringify({ success: true, message: "Wishlist renamed" });
    }
    return JSON.stringify({ success: false, message: responseData?.message || "Failed to rename" });
  },
  {
    name: "update_wishlist_name",
    description: `Renames a wishlist. Use when user says: 'rename wishlist', 'change wishlist name'.`,
    schema: z.object({
      wishlistId: z.string().describe("The _id of the wishlist"),
      name: z.string().describe("New name for the wishlist"),
    }),
  }
);

const updateItemQuantityTool = tool(
  async ({ wishlistId, itemId, quantity }, config) => {
    const user = config?.configurable?.user;
    const req = {
      user: { id: user._id || user.id },
      body: { quantity },
      params: { id: wishlistId, itemId },
      query: {}
    };
    const res = buildMockRes();
    await updateItemQuantityHandler(req, res);
    const { statusCode, responseData } = res.getData();
    if (statusCode === 200 && responseData?.success) {
      return JSON.stringify({ success: true, message: "Quantity updated" });
    }
    return JSON.stringify({ success: false, message: responseData?.message || "Failed to update quantity" });
  },
  {
    name: "update_wishlist_item_quantity",
    description: `Updates quantity of an item in a wishlist. Use when user says: 'change quantity in wishlist'.`,
    schema: z.object({
      wishlistId: z.string().describe("The _id of the wishlist"),
      itemId: z.string().describe("The _id of the item in the wishlist"),
      quantity: z.any().describe("New quantity — must be a number, minimum 1"),
    }),
  }
);

// ─── Rating Tools ─────────────────────────────────────────────────

const submitRatingTool = tool(
  async ({ orderId, restaurantRating, restaurantReview, riderRating, riderReview }, config) => {
    try {
      const user = config?.configurable?.user;
      const req = {
        user: { id: user._id || user.id },
        params: { orderId },
        body: {
          restaurantRating: restaurantRating ? toNum(restaurantRating) : undefined,
          restaurantReview,
          riderRating: riderRating ? toNum(riderRating) : undefined,
          riderReview,
        },
        query: {},
      };
      const res = buildMockRes();
      await submitRatingHandler(req, res);
      const { statusCode, responseData } = res.getData();
      if (statusCode === 200 && responseData?.success) {
        return JSON.stringify({ success: true, message: 'Ratings submitted successfully' });
      }
      return JSON.stringify({ success: false, message: responseData?.message || 'Failed to submit rating' });
    } catch (e) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
  {
    name: 'submit_rating',
    description: `Submits a rating and optional review for a delivered order.
Can rate the restaurant (restaurantRating 1-5) and/or the rider (riderRating 1-5).
Only works for orders with status 'delivered'.
Use when user says: 'rate my order', 'give feedback', 'review restaurant', 'rate rider', 'leave a review'.`,
    schema: z.object({
      orderId: z.string().describe('MongoDB _id of the delivered order'),
      restaurantRating: z.any().optional().describe('Rating for the restaurant (1-5 stars)'),
      restaurantReview: z.string().optional().describe('Text review for the restaurant'),
      riderRating: z.any().optional().describe('Rating for the rider (1-5 stars)'),
      riderReview: z.string().optional().describe('Text review for the rider'),
    }),
  }
);

const getRestaurantRatingTool = tool(
  async ({ restaurantId }, config) => {
    try {
      const user = config?.configurable?.user;
      const req = {
        user: { id: user._id || user.id },
        params: { restaurantId },
        body: {}, query: {},
      };
      const res = buildMockRes();
      await getRestaurantRatingHandler(req, res);
      const { statusCode, responseData } = res.getData();
      if (statusCode === 200 && responseData?.success) {
        return JSON.stringify({ success: true, rating: responseData.rating });
      }
      return JSON.stringify({ success: false, message: responseData?.message || 'Failed to fetch rating' });
    } catch (e) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
  {
    name: 'get_restaurant_rating',
    description: `Fetches the average rating and review count of a restaurant.
Use when user asks: 'what is the rating of X', 'how good is this restaurant', 'is this place well rated'.`,
    schema: z.object({
      restaurantId: z.string().describe('MongoDB _id of the restaurant'),
    }),
  }
);

// ─── Model Factory (uses key-rotator so each retry can use a fresh key) ────
const GROQ_MODEL_NAME = "meta-llama/llama-4-scout-17b-16e-instruct";

/**
 * Creates a fresh ChatGroq instance bound to the given API key.
 * Called on every attempt by callWithGroqRotation.
 */
function createModel(apiKey) {
  return new ChatGroq({
    model: GROQ_MODEL_NAME,
    temperature: 0,
    apiKey,
  });
}

// ─── Agent ────────────────────────────────────────────────────────
const checkpointer = new MemorySaver();

// ─── Tool Registry by Role ────────────────────────────────────────
const TOOLS = {
  // Available to ALL authenticated users
  customer: [
    getAllRestaurantsTool,
    getCartTool,
    addToCartTool,
    removeFromCartTool,
    updateCartTool,
    clearCartTool,
    placeOrderTool,
    getCustomerOrdersTool,
    getOrderByIdTool,
    createPendingOrderTool,
    confirmOrderTool,
    createPaymentOrderTool,
    verifyPaymentTool,
    getPaymentStatusTool,
    getWishlistsTool,
    getWishlistByIdTool,
    createWishlistTool,
    addItemToWishlistTool,
    removeItemFromWishlistTool,
    deleteWishlistTool,
    updateWishlistNameTool,
    updateItemQuantityTool,
    getMenuItemsTool,
    // Rating tools
    submitRatingTool,
    getRestaurantRatingTool,
    // Frontend action tools
    navigateToTool,
    refreshCartUiTool,
    initiateOnlinePaymentTool,
    // Auth tools
    getMeTool,
    updateProfileTool,
    logoutTool,

  ],

  // Restaurant owner tools (subset, no cart/wishlist/rider)
  restaurant: [
    getMenuItemsTool,
    createMenuItemTool,
    updateMenuItemTool,
    deleteMenuItemTool,
    toggleKitchenTool,
    getRestaurantOrdersTool,
    getOrderByIdTool,
    updateOrderStatusTool,
    // Auth tools
    getMeTool,
    updateProfileTool,
    logoutTool,
  ],

  // Rider tools only
  rider: [
    getAvailableOrdersTool,
    riderAcceptOrderTool,
    getRiderOrdersTool,
    verifyPickupPinTool,
    verifyDeliveryPinTool,
    updateRiderLocationTool,
    getOrderByIdTool,
    // Rider profile tools
    registerRiderTool,
    getRiderStatsTool,
    toggleRiderAvailabilityTool,
    updateRiderProfileLocationTool,
    // Auth tools
    getMeTool,
    updateProfileTool,
    logoutTool,
  ],
};

function getToolsForUser(user) {
  const role = user?.role || 'customer';
  return TOOLS[role] ?? TOOLS.customer;
}

function createAgentForUser(user, apiKey) {
  const tools = getToolsForUser(user);
  console.log(`🔧 Creating agent for role: ${user?.role || 'guest'} with ${tools.length} tools (key: ...${apiKey.slice(-6)})`);

  return createReactAgent({
    llm: createModel(apiKey),
    tools,
    checkpointSaver: checkpointer,
    messageModifier: systemPrompt,
    recursionLimit: 25,
  });
}

router.post('/chat', async (req, res) => {
  const { user, userInput } = req.body;
  // console.log("--------------user=-----------------", user);
  console.log("--------------userinput-----------------", userInput);

  if (!userInput) {
    return res.status(400).json({ success: false, message: 'userInput is required' });
  }

  const isAuthenticated = !!(user?._id || user?.id);
  const userId = isAuthenticated ? (user._id || user.id).toString() : "guest";

  if (!isAuthenticated) {
    return res.json({
      success: true,
      message: "You need to be logged in to do that. Please sign in or create an account to continue.",
      actions: [],
    });
  }

  // Build a rich address context line so the agent never has to call get_me just for the address
  const addrObj = user?.address || {};
  const hasCoords = addrObj.latitude != null && addrObj.longitude != null;
  const addressLine = hasCoords
    ? `address: ${addrObj.fullAddress || addrObj.street || 'saved address'} | lat: ${addrObj.latitude} | lng: ${addrObj.longitude}`
    : addrObj.street || addrObj.city
      ? `address: ${[addrObj.street, addrObj.city, addrObj.state, addrObj.zipCode].filter(Boolean).join(', ')} | coordinates: NOT SET`
      : 'address: NOT SET | coordinates: NOT SET';

  const contextualInput = `[USER STATUS: Authenticated | userId: ${userId} | role: ${user?.role || 'customer'} | ${addressLine}]\n\n${userInput}`;

  try {
    // ─── callWithGroqRotation wraps the entire agent run. ─────────────────────
    // On 429 or tool_use_failed (400) it rotates to the next Groq key and
    // retries up to (total keys) times.  After all keys are exhausted the
    // last error is re-thrown and caught by the outer catch below.
    const result = await callWithGroqRotation(async (apiKey) => {
      // Fresh pendingActions per attempt so we don't double-push on retry
      const pendingActions = [];

      const config = {
        configurable: {
          thread_id: userId,
          user: user,
          pendingActions,       // ← tools push actions here during the run
          lastUserInput: userInput, // ← used by getAllRestaurantsTool for smart nav
        },
        recursionLimit: 25,
      };

      const agent = createAgentForUser(user, apiKey);

      let finalMessage = "";
      let stepIndex = 0;

      const stream = await agent.stream(
        { messages: [new HumanMessage(contextualInput)] },
        { ...config, streamMode: "updates" }
      );

      for await (const chunk of stream) {
        console.log(`\n--- Step ${stepIndex++} ---`);
        for (const [nodeName, nodeData] of Object.entries(chunk)) {
          console.log(`🔷 Node: ${nodeName}`);
          const messages = nodeData?.messages ?? [];
          for (const m of messages) {
            const type = m._getType?.() ?? typeof m;
            const content = typeof m.content === "string"
              ? m.content.slice(0, 300)
              : JSON.stringify(m.content).slice(0, 300);
            console.log(`  [${type}]: ${content}`);
            if (m.tool_calls?.length) {
              for (const tc of m.tool_calls) {
                console.log(`  🔧 Tool call: ${tc.name}`, JSON.stringify(tc.args).slice(0, 200));
              }
            }
            if (type === "ai" && typeof m.content === "string" && m.content.trim()) {
              finalMessage = m.content;
            }
          }
        }
      }

      console.log("🤖 BigBite:", finalMessage);
      console.log("⚡ Actions:", pendingActions);

      // ── Detect text function-call leak ────────────────────────────────────
      // Some LLM responses emit the tool call as plain text instead of a
      // structured tool_calls entry, e.g.:
      //   get_customer_orders(customerId="abc123")
      // The stream ends immediately with no tool execution and the raw call
      // syntax appears as the user-facing reply.
      // This is functionally identical to a tool_use_failed failure — rotate
      // to the next key and retry so a different model run handles the request.
      const TEXT_FUNC_CALL_RE = /^\s*[a-z_][a-z0-9_]*\s*\([^)]*\)\s*$/i;
      if (TEXT_FUNC_CALL_RE.test(finalMessage)) {
        console.warn(`⚠️  Model emitted tool call as plain text: "${finalMessage.trim()}". Treating as tool_use_failed — rotating key.`);
        const fakeErr = new Error('tool_use_failed: model emitted function call as plain text');
        fakeErr.status = 400;
        fakeErr.error = { error: { code: 'tool_use_failed', message: 'text function call detected' } };
        throw fakeErr;
      }

      // Return both so the outer scope can send the response
      return { finalMessage, pendingActions };
    });

    res.json({ success: true, message: result.finalMessage, actions: result.pendingActions });

  } catch (err) {
    // ── 413 token overflow: conversation history grew too large ─────────────
    // Clear this user's MemorySaver checkpoint so the next message starts fresh,
    // then return a graceful message instead of a raw 500.
    if (err instanceof GroqTokenOverflowError) {
      console.warn(`🗑️  Clearing MemorySaver checkpoint for thread "${userId}" due to token overflow.`);
      try {
        // MemorySaver stores state keyed by { configurable: { thread_id } }.
        // Writing an empty checkpoint effectively resets the conversation.
        await checkpointer.put(
          { configurable: { thread_id: userId } },
          { v: 1, ts: new Date().toISOString(), id: userId, channel_values: { messages: [] }, channel_versions: {}, versions_seen: {}, pending_sends: [] },
          {}
        );
      } catch (clearErr) {
        console.error('❌ Failed to clear MemorySaver checkpoint:', clearErr.message);
      }
      return res.json({
        success: true,
        message: "Our conversation got too long, so I've cleared the chat history to keep things running smoothly. ✅ You can continue right where you left off — just send your message again!",
        actions: [],
      });
    }

    console.error("❌ Agent error (all retries exhausted):", err);
    // Return a clean, user-facing error message instead of a raw stack trace
    res.status(500).json({
      success: false,
      error: "Agent failed",
      message: "Sorry, I could not process that request. Please try again.",
      actions: [],
    });
  }
});

// const agent = createReactAgent({
//   llm: model,
//   tools: [
//     // wishlist tools
//     getWishlistsTool,
//     getWishlistByIdTool,
//     createWishlistTool,
//     addItemToWishlistTool,
//     removeItemFromWishlistTool,
//     deleteWishlistTool,
//     updateWishlistNameTool,
//     updateItemQuantityTool,
//     // restaurant tools
//     getAllRestaurantsTool,
//     toggleKitchenTool,
//     deleteMenuItemTool,
//     updateMenuItemTool,
//     getMenuItemsTool,
//     createMenuItemTool,
//     //order tools
//     placeOrderTool,
//     getCustomerOrdersTool,
//     getOrderByIdTool,
//     updateOrderStatusTool,
//     getAvailableOrdersTool,
//     riderAcceptOrderTool,
//     getRiderOrdersTool,
//     verifyPickupPinTool,
//     verifyDeliveryPinTool,
//     updateRiderLocationTool,
//     getRestaurantOrdersTool,
//     createPendingOrderTool,
//     confirmOrderTool,
//     //payment tools
//     createPaymentOrderTool,
//     verifyPaymentTool,
//     getPaymentStatusTool,
//     // cart tools
//     getCartTool,
//     addToCartTool,
//     removeFromCartTool,
//     updateCartTool,
//     clearCartTool,

//   ],
//   checkpointSaver: checkpointer,
//   messageModifier: systemPrompt,
// });

// ─── Chat Route ───────────────────────────────────────────────────
// router.post('/chat', async (req, res) => {
//   try {
//     const { user, userInput } = req.body;
//     console.log("--------------user=-----------------",user)
//     console.log("--------------userinput=-----------------",userInput)
//     if (!userInput) {
//       return res.status(400).json({ success: false, message: 'userInput is required' });
//     }

//     const userId = user?._id?.toString() || "guest";

//     const config = {
//       configurable: {
//         thread_id: userId,
//         user: user,
//       },
//     };

//     const response = await agent.invoke(
//       { messages: [new HumanMessage(userInput)] },
//       config,
//     );
//     response.messages.forEach((m, i) => {
//       console.log(`[${i}] ${m._getType()}:`, 
//         typeof m.content === 'string' ? m.content.slice(0, 200) : m.content
//       );
//     });

//     const message = response.messages.at(-1).content;
//     console.log("🤖 BigBite:", message);

//     res.json({ success: true, message });

//   } catch (err) {
//     console.error("❌ Agent error:", err);
//     res.status(500).json({ success: false, error: "Agent failed", message: err.message });
//   }
// });

// router.post('/chat', async (req, res) => {
//   try {
//     const { user, userInput } = req.body;
//     console.log("--------------user=-----------------", user);
//     console.log("--------------userinput=-----------------", userInput);

//     if (!userInput) {
//       return res.status(400).json({ success: false, message: 'userInput is required' });
//     }

//     const isAuthenticated = !!(user?._id || user?.id);
//     const userId = isAuthenticated ? (user._id || user.id).toString() : "guest";

//     // ✅ Prepend user context to every message
//     const contextualInput = isAuthenticated
//       ? `[USER STATUS: Authenticated | userId: ${userId}]\n\n${userInput}`
//       : `[USER STATUS: Guest — Not logged in | No user session available]\n\n${userInput}`;


//     const config = {
//       configurable: {
//         thread_id: userId,
//         user: user,
//       },
//       // recursionLimit: 50, // safety bump while debugging
//     };

//     let finalMessage = "";
//     let stepIndex = 0;

//     // ✅ stream instead of invoke — logs every agent step in real time
//     const stream = await agent.stream(
//       { messages: [new HumanMessage(contextualInput)] },
//       { ...config, streamMode: "updates" }
//     );

//     for await (const chunk of stream) {
//       console.log(`\n--- Step ${stepIndex++} ---`);

//       for (const [nodeName, nodeData] of Object.entries(chunk)) {
//         console.log(`🔷 Node: ${nodeName}`);

//         const messages = nodeData?.messages ?? [];
//         for (const m of messages) {
//           const type = m._getType?.() ?? typeof m;
//           const content = typeof m.content === "string"
//             ? m.content.slice(0, 300)
//             : JSON.stringify(m.content).slice(0, 300);

//           console.log(`  [${type}]: ${content}`);

//           // log tool calls if present
//           if (m.tool_calls?.length) {
//             for (const tc of m.tool_calls) {
//               console.log(`  🔧 Tool call: ${tc.name}`, JSON.stringify(tc.args).slice(0, 200));
//             }
//           }

//           // capture last AI message as final reply
//           if (type === "ai" && typeof m.content === "string" && m.content.trim()) {
//             finalMessage = m.content;
//           }
//         }
//       }
//     }

//     console.log("🤖 BigBite:", finalMessage);
//     res.json({ success: true, message: finalMessage });

//   } catch (err) {
//     console.error("❌ Agent error:", err);
//     res.status(500).json({ success: false, error: "Agent failed", message: err.message });
//   }
// });

export default router;
