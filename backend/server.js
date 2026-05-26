import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import mongoose from 'mongoose';
import { createServer } from 'http';
import { Server } from 'socket.io';
import passport from './config/passport.js';
import { configurePassport } from './config/passport.js';
// Import models
import User from './models/User.js';
import Order from './models/Order.js';
// Import routes
import authRoutes from './routes/auth.js';
import restaurantRoutes from './routes/restaurant.js';
import cartRoutes from "./routes/cart.js";
import orderRoutes from "./routes/order.js";
import riderRoutes from "./routes/rider.js";
import ratingRoutes from "./routes/rating.js";
import wishlistRoutes from "./routes/wishlist.js";
import chatbotRoutes from "./routes/chatbot.js";
import paymentRoutes from "./routes/payment.js";
import { mapOrderToSocketData } from './utils/orderSocketData.js';

// Load env vars
dotenv.config();

// ----- PROMETHEUS METRICS SETUP ----- //
import client from 'prom-client';
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ register: client.register });

const httpRequestDurationMicroseconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'code'],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10]
});

const app = express();

// Prometheus middleware to log incoming requests
app.use((req, res, next) => {
  res.on('finish', () => {
    httpRequestDurationMicroseconds
      .labels(req.method, req.route ? req.route.path : req.path, res.statusCode)
      .observe(1); // Simplified observation
  });
  next();
});

// Setup prometheus /metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

const httpServer = createServer(app);

// Build an explicit allowlist; credentials cannot be combined with '*'
const allowedOrigins = [
  process.env.FRONTEND_URL,            // e.g., https://www.bigbitefoods.shop
  process.env.FRONTEND_URL?.replace('www.', ''),
  process.env.APPROVED_SITE_URL,       // e.g., https://bharat-kumar-19030.github.io
  'http://localhost:5173',
].filter(Boolean);


console.log('🔧 Current FRONTEND_URL env:', process.env.FRONTEND_URL);

// Simple CORS configuration - allow all origins in production for maximum compatibility
export const io = new Server(httpServer, {
  cors: {
    origin:[process.env.FRONTEND_URL,
            process.env.FRONTEND_URL?.replace('www.', ''),
            process.env.APPROVED_SITE_URL,
            'http://localhost:5173'
          ].filter(Boolean),
    credentials: true,
  },
  transports: ["polling", "websocket"],
  pingInterval: 25000,
  pingTimeout: 60000,
});



app.use(
  cors({
    origin:[process.env.FRONTEND_URL,
            process.env.FRONTEND_URL?.replace('www.', ''),
            process.env.APPROVED_SITE_URL,
            'http://localhost:5173'
          ].filter(Boolean),
    credentials: true,
  })
);

// app.use(cors())
app.options('*', cors()); // Enable pre-flight for all routes(means all routes will accept OPTIONS method, here OPTIONS method is preflight request ,preflight is an initial request made to check if the actual request is safe to send)
app.use(cookieParser()); 
app.use(express.json())

if (!process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET is not set');
  process.exit(1);
}

if (!process.env.MONGODB_URI) {
  console.error('FATAL: MONGODB_URI is not set');
  process.exit(1);
}
// Express session with MongoDB-backed store (recommended for production)
const sessionStore = MongoStore.create({
  mongoUrl: process.env.MONGODB_URI,
  collectionName: process.env.SESSIONS_COLLECTION || 'sessions',
  ttl: 24 * 60 * 60, // 1 day
});

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change_this_secret',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? "none" : "lax",
      maxAge: 24 * 60 * 60 * 1000,
    }
  })
);

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Configure passport strategies
configurePassport();

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('MongoDB connected successfully');
    await hydrateActiveOrdersPool();
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/restaurant', restaurantRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/rider", riderRoutes);
app.use("/api/rating", ratingRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/chatbot", chatbotRoutes);
app.use("/api/payment", paymentRoutes);

// Active riders pool - stores rider socket connections with live data
export const activeRidersPool = new Map();
// Active orders pool - stores order details with real-time updates
export const activeOrdersPool = new Map();

// Reload in-memory pools from database on startup so reconnecting clients don't lose active orders
async function hydrateActiveOrdersPool() {
  try {
    const openStatuses = ['pending', 'accepted', 'awaiting_rider', 'rider_assigned', 'preparing', 'ready', 'on_the_way'];
    const openOrders = await Order.find({ status: { $in: openStatuses } })
      .populate([
        { path: 'customer', select: 'name phone' },
        { path: 'restaurant', select: 'restaurantDetails' },
        { path: 'items.menuItem', select: 'name price image category' },
      ]);

    openOrders.forEach((order) => {
      const socketPayload = mapOrderToSocketData(order);
      if (socketPayload?.orderId) {
        activeOrdersPool.set(socketPayload.orderId, socketPayload);
      }
    });

    console.log(`Hydrated activeOrdersPool with ${activeOrdersPool.size} orders`);
  } catch (err) {
    console.error('Failed to hydrate activeOrdersPool:', err);
  }
}

function getActiveOrdersForRestaurant(restaurantId) {
  if (!restaurantId) return [];
  return Array.from(activeOrdersPool.values()).filter(
    (order) => order.restaurantId === restaurantId.toString()
  );
}

function joinRestaurantToOrderRooms(socket, restaurantId, orders) {
  orders.forEach((order) => {
    if (order.orderId) {
      socket.join(`order_${order.orderId}`);
    }
  });
}

async function syncRiderActiveOrders(riderId, riderDoc, riderCoords) {
  const activeStatuses = ['rider_assigned', 'preparing', 'ready', 'picked_up', 'on_the_way'];
  const assignedOrders = await Order.find({
    rider: riderId,
    status: { $in: activeStatuses },
  }).populate([
    { path: 'customer', select: 'name phone' },
    { path: 'restaurant', select: 'restaurantDetails' },
    { path: 'items.menuItem', select: 'name price image category' },
  ]);

  const orderIds = [];

  assignedOrders.forEach((order) => {
    const key = order._id.toString();
    const socketPayload = activeOrdersPool.get(key) || mapOrderToSocketData(order);
    socketPayload.status = order.status;
    socketPayload.riderId = riderId;
    socketPayload.riderDetails = {
      name: riderDoc?.name,
      phone: riderDoc?.phone,
    };
    socketPayload.riderCoordinates = riderCoords || socketPayload.riderCoordinates;
    activeOrdersPool.set(key, socketPayload);
    orderIds.push(key);
  });

  return orderIds;
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);
  
  // User authentication
  socket.on('authenticate', (userId) => {
    try {
      socket.userId = userId;
      socket.join(`user_${userId}`);
      console.log(`✅ User ${userId} authenticated`);
    } catch (error) {
      console.error('❌ Error in authenticate:', error);
    }
  });

  // Rider authentication - join rider room
  socket.on('rider_authenticate', (userId) => {
    try {
      socket.userId = userId;
      socket.riderId = userId;
      socket.join(`user_${userId}`);
      socket.join(`rider_${userId}`);
      console.log(`✅ Rider ${userId} authenticated and joined rider room`);
    } catch (error) {
      console.error('❌ Error in rider_authenticate:', error);
    }
  });
  
  // Rider joins active pool when available
  socket.on('rider_join_pool', async ({ riderId, coordinates }) => {
    try {
      const rider = await User.findById(riderId);
      if (!rider || rider.role !== 'rider') {
        socket.emit('error', { message: 'Invalid rider' });
        return;
      }

      // Use coordinates from the emit or fallback to database
      const riderCoords = coordinates || {
        latitude: rider.riderDetails?.currentLocation?.latitude || 0,
        longitude: rider.riderDetails?.currentLocation?.longitude || 0,
      };

      // Ensure active orders are repopulated for this rider (e.g., after reload)
      const riderActiveOrders = await syncRiderActiveOrders(riderId, rider, riderCoords);

      // Add rider to active pool
      activeRidersPool.set(riderId, {
        socketId: socket.id,
        riderId,
        name: rider.name,
        phone: rider.phone,
        coordinates: riderCoords,
        activeOrders: riderActiveOrders,
        lastUpdate: new Date(),
      });

      socket.riderId = riderId;
      socket.join(`rider_${riderId}`);
      
      console.log(`🏍️ Rider ${rider.name} (${riderId}) joined active pool at [${riderCoords.latitude}, ${riderCoords.longitude}] with ${riderActiveOrders.length} active order(s)`);
      console.log(`📊 Total active riders: ${activeRidersPool.size}`);
      socket.emit('joined_pool', { message: 'Successfully joined active riders pool', activeOrders: riderActiveOrders });
    } catch (error) {
      console.error('❌ Error in rider_join_pool:', error);
    }
  });

  // Rider leaves active pool when unavailable
  socket.on('rider_leave_pool', ({ riderId }) => {
    try {
      activeRidersPool.delete(riderId);
      socket.leave(`rider_${riderId}`);
      console.log(`🚫 Rider ${riderId} left active pool. Total active: ${activeRidersPool.size}`);
      socket.emit('left_pool', { message: 'Left active riders pool' });
    } catch (error) {
      console.error('❌ Error in rider_leave_pool:', error);
    }
  });

  // Rider live location update (every 10 seconds, not saved to DB)
  socket.on('rider_location_update', ({ riderId, coordinates }) => {
    try {
      console.log(`📍 Rider location update from ${riderId}: lat=${coordinates?.latitude}, lon=${coordinates?.longitude}`);
      const riderData = activeRidersPool.get(riderId);
      if (riderData) {
        riderData.coordinates = coordinates;
        riderData.lastUpdate = new Date();
        activeRidersPool.set(riderId, riderData);

        // Broadcast location to all active orders this rider is handling
        riderData.activeOrders.forEach(orderId => {
          const orderSocket = activeOrdersPool.get(orderId);
          if (orderSocket) {
            orderSocket.riderCoordinates = coordinates;
            activeOrdersPool.set(orderId, orderSocket);
            
            // Emit to customer tracking the order
            io.to(`order_${orderId}`).emit('rider_location_live', {
              orderId,
              latitude: coordinates.latitude,
              longitude: coordinates.longitude,
              timestamp: new Date(),
            });
          }
        });
      }
    } catch (error) {
      console.error('❌ Error in rider_location_update:', error);
    }
  });

  // Customer joins order tracking room
  socket.on('join_order_tracking', (orderId) => {
    try {
      socket.join(`order_${orderId}`);
      
      // Send current order status if exists
      const orderSocket = activeOrdersPool.get(orderId);
      if (orderSocket) {
        socket.emit('order_status', orderSocket);
      }
      
      console.log(`👤 Customer joined order tracking: ${orderId}`);
    } catch (error) {
      console.error('❌ Error in join_order_tracking:', error);
    }
  });

  // Restaurant authentication
  socket.on('restaurant_authenticate', ({ restaurantId }) => {
    try {
      socket.restaurantId = restaurantId;
      socket.join(`restaurant_${restaurantId}`);
      console.log(`🏪 Restaurant ${restaurantId} authenticated and joined room`);
      socket.emit('authenticated', { message: 'Restaurant authenticated successfully' });

      const activeOrders = getActiveOrdersForRestaurant(restaurantId);
      joinRestaurantToOrderRooms(socket, restaurantId, activeOrders);
      if (activeOrders.length) {
        socket.emit('active_orders_snapshot', activeOrders);
      }
    } catch (error) {
      console.error('❌ Error in restaurant_authenticate:', error);
    }
  });

  // Restaurant accepts order
  socket.on('restaurant_accept_order', async ({ orderId, restaurantId }) => {
    try {
      const order = await Order.findById(orderId);
      if (!order) {
        socket.emit('error', { message: 'Order not found' });
        return;
      }

      order.status = 'accepted';
      order.acceptedAt = new Date();
      await order.save();

      // Update order socket
      const orderSocket = activeOrdersPool.get(orderId);
      if (orderSocket) {
        orderSocket.status = 'accepted';
        orderSocket.acceptedAt = new Date();
        activeOrdersPool.set(orderId, orderSocket);
      }

      // Notify customer
      io.to(`order_${orderId}`).emit('order_status_changed', {
        orderId,
        status: 'accepted',
        message: 'Restaurant accepted your order',
      });

      // Notify restaurant to update their UI
      io.to(`restaurant_${restaurantId}`).emit('order_status_changed', {
        orderId,
        status: 'accepted',
        message: 'Order accepted successfully',
      });

      // Notify nearby riders
      await notifyNearbyRiders(order);

      console.log(`✅ Restaurant accepted order: ${orderId}`);
    } catch (error) {
      console.error('❌ Error in restaurant_accept_order:', error);
    }
  });

  // Restaurant rejects order
  socket.on('restaurant_reject_order', async ({ orderId, reason }) => {
    try {
      const order = await Order.findById(orderId);
      if (!order) return;

      order.status = 'rejected';
      order.cancelledAt = new Date();
      order.cancellationReason = reason;
      order.cancelledBy = 'restaurant';
      await order.save();

      // Remove from active orders
      activeOrdersPool.delete(orderId);

      // Notify customer
      io.to(`order_${orderId}`).emit('order_status_changed', {
        orderId,
        status: 'rejected',
        message: 'Restaurant rejected your order',
        reason,
      });

      console.log(`❌ Restaurant rejected order: ${orderId}`);
    } catch (error) {
      console.error('❌ Error in restaurant_reject_order:', error);
    }
  });

  // Rider accepts order
  socket.on('rider_accept_order', async ({ orderId, riderId }) => {
    try {
      const order = await Order.findById(orderId).populate('restaurant customer rider');
      const statusIsAvailable = order?.status === 'accepted' || order?.status === 'awaiting_rider';

      if (!order || !statusIsAvailable) {
        socket.emit('error', { message: 'Order not available' });
        return;
      }

      // Calculate distance from restaurant to customer
      const restaurant = await User.findById(order.restaurant._id);
      const distanceToCustomer = calculateDistance(
        restaurant.restaurantDetails.address.latitude,
        restaurant.restaurantDetails.address.longitude,
        order.deliveryAddress.latitude,
        order.deliveryAddress.longitude
      );
      
      // Rider earnings logic:
      // - If customer paid delivery fee (order < ₹500): rider gets same amount
      // - If customer got free delivery (order ≥ ₹500): calculate rider earnings separately (₹8/km)
      const riderEarnings = order.deliveryFee > 0 
        ? order.deliveryFee 
        : Math.round(distanceToCustomer * 8);

      order.rider = riderId;
      order.status = 'rider_assigned';
      order.acceptedAt = new Date();
      order.distanceToCustomer = distanceToCustomer;
      order.riderEarnings = riderEarnings;
      await order.save();

      // Get rider details
      const riderData = activeRidersPool.get(riderId);
      const riderUser = await User.findById(riderId);

      // Update rider's active orders
      if (riderData) {
        riderData.activeOrders.push(orderId);
        activeRidersPool.set(riderId, riderData);
      }

      // Update order socket
      const orderSocket = activeOrdersPool.get(orderId);
      if (orderSocket) {
        orderSocket.status = 'rider_assigned';
        orderSocket.riderId = riderId;
        orderSocket.riderDetails = {
          name: riderUser?.name,
          phone: riderUser?.phone,
        };
        orderSocket.riderCoordinates = riderData?.coordinates;
        activeOrdersPool.set(orderId, orderSocket);
      }

      // Remove from other riders' available list
      Array.from(activeRidersPool.keys()).forEach(otherId => {
        if (otherId !== riderId) {
          io.to(`rider_${otherId}`).emit('order_taken', { orderId });
        }
      });

      // Notify customer via order room
      io.to(`order_${orderId}`).emit('order_status_changed', {
        orderId,
        status: 'rider_assigned',
        message: `Rider ${riderUser?.name || 'A rider'} accepted your order!`,
        riderName: riderUser?.name,
        riderPhone: riderUser?.phone,
      });

      // Also emit order_accepted event for customer
      io.to(`order_${orderId}`).emit('order_accepted', {
        orderId,
        status: 'rider_assigned',
        message: `Rider ${riderUser?.name || 'A rider'} accepted your order!`,
        riderName: riderUser?.name,
        riderPhone: riderUser?.phone,
      });

      // Notify restaurant to refresh dashboard
      io.to(`restaurant_${order.restaurant._id}`).emit('order_status_changed', {
        orderId,
        status: 'rider_assigned',
        riderName: riderUser?.name,
        riderPhone: riderUser?.phone,
      });

      // Confirm acceptance to the rider
      socket.emit('order_accepted_confirmation', {
        orderId,
        success: true,
        message: 'Order accepted successfully'
      });

      console.log(`🏍️ Rider ${riderId} accepted order: ${orderId}`);
    } catch (error) {
      console.error('❌ Error in rider_accept_order:', error);
      socket.emit('order_accept_error', {
        message: 'Failed to accept order',
        error: error.message
      });
    }
  });

  // Update order status
  socket.on('update_order_status', async ({ orderId, status }) => {
    try {
      const order = await Order.findById(orderId);
      if (!order) return;

      order.status = status;
      
      // Update timestamps based on status
      if (status === 'accepted') order.acceptedAt = new Date();
      if (status === 'picked_up') order.pickedUpAt = new Date();
      if (status === 'delivered') order.deliveredAt = new Date();
      if (status === 'cancelled') {
        order.cancelledAt = new Date();
        order.cancelledBy = 'rider';
      }
      
      await order.save();

      // Update order socket
      const orderSocket = activeOrdersPool.get(orderId);
      if (orderSocket) {
        orderSocket.status = status;
        activeOrdersPool.set(orderId, orderSocket);
      }

      // Broadcast to all parties
      io.to(`order_${orderId}`).emit('order_status_changed', {
        orderId,
        status,
        timestamp: new Date(),
      });

      // Also notify restaurant room so dashboard updates immediately
      io.to(`restaurant_${order.restaurant}`).emit('order_status_changed', {
        orderId,
        status,
        timestamp: new Date(),
      });

      // If delivered, remove from active pools
      if (status === 'delivered') {
        const riderId = order.rider;
        const riderData = activeRidersPool.get(riderId?.toString());
        if (riderData) {
          riderData.activeOrders = riderData.activeOrders.filter(id => id !== orderId);
          activeRidersPool.set(riderId.toString(), riderData);
        }
        activeOrdersPool.delete(orderId);
      }

      console.log(`📊 Order ${orderId} status updated to: ${status}`);
    } catch (error) {
      console.error('❌ Error in update_order_status:', error);
    }
  });

  // socket.on('disconnect', () => {
  //   // Remove rider from pool if disconnected
  //   if (socket.riderId) {
  //     activeRidersPool.delete(socket.riderId);
  //     console.log(`🔌 Rider ${socket.riderId} disconnected. Total active: ${activeRidersPool.size}`);
  //   }
  //   console.log('🔌 Client disconnected:', socket.id);
  // });
  socket.on("disconnect", () => {
  if (socket.riderId) {
    const riderId = socket.riderId;

    setTimeout(() => {
      const rider = activeRidersPool.get(riderId);
      if (rider && rider.socketId === socket.id) {
        activeRidersPool.delete(riderId);
        console.log(` Rider ${riderId} removed after timeout`);
      }
    }, 30000); // 30s grace period
  }

  console.log("🔌 Client disconnected:", socket.id);
});


});

// Helper function to notify nearby riders
export async function notifyNearbyRiders(order) {
  try {
    console.log('🔔 notifyNearbyRiders called for order:', order._id);
    
    const restaurant = await User.findById(order.restaurant);
    if (!restaurant) {
      console.error('❌ Restaurant not found:', order.restaurant);
      return;
    }
    
    console.log('🏪 Restaurant found:', restaurant.restaurantDetails?.kitchenName);
    console.log('📍 Restaurant address:', restaurant.restaurantDetails?.address);
    
    if (!restaurant.restaurantDetails?.address?.latitude || !restaurant.restaurantDetails?.address?.longitude) {
      console.error('❌ Restaurant does not have valid coordinates');
      return;
    }
    
    const restaurantLat = restaurant.restaurantDetails.address.latitude;
    const restaurantLon = restaurant.restaurantDetails.address.longitude;

    const nearbyRiders = [];
    
    console.log(`\n🔍 Searching for riders within 200km radius...`);
    console.log(`📍 Restaurant Location: Lat ${restaurantLat}, Lon ${restaurantLon}`);
    console.log(`👥 Total active riders in pool: ${activeRidersPool.size}`);
    
    activeRidersPool.forEach((riderData, riderId) => {
      // Calculate distance from rider to restaurant
      const distance = calculateDistance(
        restaurantLat,
        restaurantLon,
        riderData.coordinates.latitude,
        riderData.coordinates.longitude
      );

      console.log(`\n🏍️ Rider: ${riderData.name} (ID: ${riderId})`);
      console.log(`   📍 Location: Lat ${riderData.coordinates.latitude}, Lon ${riderData.coordinates.longitude}`);
      console.log(`   📏 Distance: ${distance.toFixed(2)} km`);
      console.log(`   ${distance <= 1000 ? '✅ Within range!' : '❌ Too far'}`);

      if (distance <= 1000) {
        nearbyRiders.push({ riderId, riderName: riderData.name, distance });
      }
    });

    console.log(`\n✅ Found ${nearbyRiders.length} riders within 1000km:`);
    nearbyRiders.forEach(({ riderName, distance }) => {
      console.log(`   🏍️ ${riderName} - ${distance.toFixed(2)} km away`);
    });

    // Send notification to nearby riders
    nearbyRiders.forEach(({ riderId, riderName, distance }) => {
      console.log(`📤 Sending order notification to: ${riderName} (rider_${riderId})`);
      
      // Calculate distance from restaurant to customer for display
      const distanceToCustomer = calculateDistance(
        restaurantLat,
        restaurantLon,
        order.deliveryAddress.latitude,
        order.deliveryAddress.longitude
      );
      
      // Rider earnings logic:
      // - If customer paid delivery fee (order < ₹500): rider gets same amount
      // - If customer got free delivery (order ≥ ₹500): calculate rider earnings separately
      const riderEarnings = order.deliveryFee > 0 
        ? order.deliveryFee 
        : Math.round(distanceToCustomer * 8);
      
      io.to(`rider_${riderId}`).emit('new_order_available', {
        orderId: order._id,
        restaurantName: restaurant.restaurantDetails.kitchenName,
        restaurantAddress: restaurant.restaurantDetails.address,
        deliveryAddress: order.deliveryAddress,
        totalAmount: order.totalAmount,
        distance: distance.toFixed(2), // Distance from rider to restaurant
        distanceToCustomer: distanceToCustomer.toFixed(2), // Distance from restaurant to customer
        riderEarnings, // Earnings based on delivery distance
        paymentMethod: order.paymentMethod, // Payment mode (cod or online)
        items: order.items,
      });
    });
    
    console.log('✅ Notification process completed');
  } catch (error) {
    console.error('❌ Error notifying nearby riders:', error);
  }
}

// Haversine formula for distance calculation
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); // c is the angular distance in radians
  return R * c;
}

// Auto-reject orders after 10 minutes of no action
setInterval(async () => {
  try {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const pendingOrders = await Order.find({
      status: 'pending',
      createdAt: { $lt: tenMinutesAgo },
    });

    const riderAwaitingOrders = await Order.find({
      status: { $in: ['accepted', 'awaiting_rider'] },
      rider: null,
      $or: [
        { acceptedAt: { $lt: tenMinutesAgo } },
        { acceptedAt: null, createdAt: { $lt: tenMinutesAgo } },
      ],
    });

    const toReject = [...pendingOrders, ...riderAwaitingOrders];

    for (const order of toReject) {
      const previousStatus = order.status;
      order.status = 'auto_rejected';
      order.rejectionReason = 'No response within 10 minutes';
      order.cancelledBy = previousStatus === 'pending' ? 'restaurant' : 'rider';
      await order.save();

      activeOrdersPool.delete(order._id.toString());

      io.to(`order_${order._id}`).emit('order_status_changed', {
        orderId: order._id,
        status: 'auto_rejected',
        message: 'Order automatically rejected due to no response',
      });

      io.to(`restaurant_${order.restaurant}`).emit('order_status_changed', {
        orderId: order._id,
        status: 'auto_rejected',
        message: 'Order automatically rejected due to no response',
      });

      console.log(`⏱️ Auto-rejected order: ${order._id}`);
    }
  } catch (error) {
    console.error('Error in auto-reject interval:', error);
  }
}, 60000); // Check every minute

// Health check route
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is healthy and running now ',
    timestamp: new Date().toISOString(),
  });
});

// Debug route to check socket pools
app.get('/api/debug/pools', (req, res) => {
  const connectedSockets = [];
  io.sockets.sockets.forEach((socket) => {
    connectedSockets.push({
      id: socket.id,
      userId: socket.userId,
      riderId: socket.riderId,
      restaurantId: socket.restaurantId,
      rooms: Array.from(socket.rooms),
    });
  });

  res.json({
    activeRiders: activeRidersPool.size,
    activeOrders: activeOrdersPool.size,
    connectedSockets: connectedSockets.length,
    sockets: connectedSockets,
    riderPool: Array.from(activeRidersPool.entries()).map(([id, data]) => ({
      riderId: id,
      socketId: data.socketId,
      coordinates: data.coordinates,
      activeOrders: data.activeOrders,
    })),
    orderPool: Array.from(activeOrdersPool.entries()).map(([id, data]) => ({
      orderId: id,
      status: data.status,
      restaurantId: data.restaurantId,
      riderId: data.riderId,
    })),
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Server Error',
  });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
}); 

const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
  console.log(`Frontend URL: ${process.env.FRONTEND_URL}`);
  console.log(`API Base URL: http://localhost:${PORT}/api`);
  console.log(`Socket.IO enabled`);
}).on('error', (err) => {
  console.error('Server error:', err);
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
    process.exit(1);
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
  console.error(err.stack);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  console.error(err.stack);
});
