import express from 'express';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// ─────────────────────────────────────────────────────────────────
//  EXPORTED HANDLER FUNCTIONS  (used by chatbot.js agent tools)
// ─────────────────────────────────────────────────────────────────

// @desc    Get user's cart
// @route   GET /api/cart
// @access  Private
export async function getCartHandler(req, res) {
  try {
    const user = await User.findById(req.user.id)
      .populate({
        path: 'cart.menuItem',
        select: 'name description price image isVeg category subCategory cuisine isAvailable',
      })
      .populate({
        path: 'cart.restaurantId',
        select: 'restaurantDetails.kitchenName restaurantDetails.isKitchenOpen restaurantDetails.address',
      });

    res.status(200).json({
      success: true,
      cart: user.cart,
    });
  } catch (error) {
    console.error('❌ Get cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting cart',
    });
  }
}

// @desc    Add item to cart
// @route   POST /api/cart/add
// @access  Private
export async function addToCartHandler(req, res) {
  try {
    const { menuItem, quantity, restaurantId } = req.body;
    console.log('📝 Add to cart request:', { menuItem, quantity, restaurantId, userId: req.user.id });

    if (!menuItem || !quantity || !restaurantId) {
      return res.status(400).json({
        success: false,
        message: 'menuItem, quantity and restaurantId are required',
      });
    }
    if (quantity < 1) {
      return res.status(400).json({
        success: false,
        message: 'Quantity must be at least 1',
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const existingItemIndex = user.cart.findIndex(
      item => item.menuItem.toString() === menuItem.toString()
    );

    if (existingItemIndex > -1) {
      user.cart[existingItemIndex].quantity += quantity;
      console.log('✅ Updated existing cart item quantity');
    } else {
      user.cart.push({ menuItem, quantity, restaurantId });
      console.log('✅ Added new item to cart with restaurantId:', restaurantId);
    }

    await user.save();
    console.log('✅ Cart saved. Total items:', user.cart.length);

    await user.populate({
      path: 'cart.menuItem',
      select: 'name description price image isVeg category subCategory cuisine isAvailable',
    });
    await user.populate({
      path: 'cart.restaurantId',
      select: 'restaurantDetails.kitchenName restaurantDetails.isKitchenOpen restaurantDetails.address',
    });

    res.status(200).json({
      success: true,
      cart: user.cart,
      message: 'Item added to cart',
    });
  } catch (error) {
    console.error('❌ Add to cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding item to cart',
    });
  }
}

// @desc    Update entire cart (bulk replace)
// @route   PUT /api/cart
// @access  Private
export async function updateCartHandler(req, res) {
  try {
    const { cart } = req.body;

    if (!Array.isArray(cart)) {
      return res.status(400).json({ success: false, message: 'cart must be an array' });
    }

    for (const item of cart) {
      if (!item.menuItem || !item.quantity || !item.restaurantId) {
        return res.status(400).json({
          success: false,
          message: 'Each cart item must have menuItem, quantity and restaurantId',
        });
      }
      if (item.quantity < 1) {
        return res.status(400).json({
          success: false,
          message: 'Quantity must be at least 1',
        });
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { cart },
      { new: true, runValidators: true }
    ).populate('cart.menuItem');

    res.status(200).json({
      success: true,
      cart: user.cart,
      message: 'Cart updated successfully',
    });
  } catch (error) {
    console.error('❌ Update cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating cart',
    });
  }
}

// @desc    Remove a single item from cart
// @route   DELETE /api/cart/remove/:menuItemId
// @access  Private
export async function removeFromCartHandler(req, res) {
  try {
    const user = await User.findById(req.user.id);
    user.cart = user.cart.filter(
      item => item.menuItem.toString() !== req.params.menuItemId
    );
    await user.save();

    await user.populate({
      path: 'cart.menuItem',
      select: 'name description price image isVeg category subCategory cuisine isAvailable',
    });
    await user.populate({
      path: 'cart.restaurantId',
      select: 'restaurantDetails.kitchenName restaurantDetails.isKitchenOpen restaurantDetails.address',
    });

    res.status(200).json({
      success: true,
      cart: user.cart,
      message: 'Item removed from cart',
    });
  } catch (error) {
    console.error('❌ Remove from cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Error removing item from cart',
    });
  }
}

// @desc    Clear entire cart
// @route   DELETE /api/cart/clear
// @access  Private
export async function clearCartHandler(req, res) {
  try {
    const user = await User.findById(req.user.id);
    user.cart = [];
    await user.save();

    res.status(200).json({
      success: true,
      cart: user.cart,
      message: 'Cart cleared successfully',
    });
  } catch (error) {
    console.error('❌ Clear cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Error clearing cart',
    });
  }
}

// ─────────────────────────────────────────────────────────────────
//  EXPRESS ROUTES  (unchanged — API behaviour stays identical)
// ─────────────────────────────────────────────────────────────────

router.get('/',                     protect, getCartHandler);
router.post('/add',                 protect, addToCartHandler);
router.put('/',                     protect, updateCartHandler);
router.delete('/remove/:menuItemId',protect, removeFromCartHandler);
router.delete('/clear',             protect, clearCartHandler);

export default router;