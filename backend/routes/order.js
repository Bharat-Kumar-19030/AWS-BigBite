import express from 'express';
import Order from '../models/Order.js';
import User from '../models/User.js';
import Payment from '../models/Payment.js';
import { io, activeOrdersPool, activeRidersPool, notifyNearbyRiders } from '../server.js';
import { mapOrderToSocketData } from '../utils/orderSocketData.js';

const router = express.Router();

// ─────────────────────────────────────────────────────────────────
//  UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────

// Haversine formula to calculate distance between two coordinates
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Helper function to get status message
const getStatusMessage = (status) => {
  const messages = {
    preparing: 'Your order is being prepared',
    ready: 'Your order is ready for pickup',
    picked_up: 'Rider has picked up your order',
    on_the_way: 'Your order is on the way',
    delivered: 'Your order has been delivered',
    cancelled: 'Your order has been cancelled',
  };
  return messages[status] || 'Order status updated';
};

// ─────────────────────────────────────────────────────────────────
//  EXPORTED HANDLER FUNCTIONS (used by chatbot.js agent tools)
// ─────────────────────────────────────────────────────────────────

// @desc    Create pending order before payment
// @route   POST /api/orders/pending
// @access  Private
export async function createPendingOrderHandler(req, res) {
  try {
    const {
      customerId,
      restaurantId,
      items,
      deliveryAddress,
      paymentMethod,
      pricing,
    } = req.body;

    console.log('📝 Creating pending order for online payment');

    if (!customerId || !restaurantId || !items || !deliveryAddress || !paymentMethod || !pricing) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
    }

    const restaurant = await User.findById(restaurantId);

    if (!restaurant || restaurant.role !== 'restaurant') {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found',
      });
    }

    const order = new Order({
      customer: customerId,
      restaurant: restaurantId,
      items,
      deliveryAddress,
      paymentMethod,
      paymentStatus: 'pending',
      status: 'pending_payment',
      ...pricing,
    });

    await order.save();

    const deliveredKey = order._id.toString();
    activeOrdersPool.delete(deliveredKey);

    console.log('✅ Pending order created:', order._id);

    res.status(201).json({
      success: true,
      order: {
        _id: order._id,
        totalAmount: order.totalAmount,
      },
    });
  } catch (error) {
    console.error('❌ Error creating pending order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create pending order',
      error: error.message,
    });
  }
}

// @desc    Confirm order after successful payment
// @route   POST /api/orders/:orderId/confirm
// @access  Private
export async function confirmOrderHandler(req, res) {
  try {
    const { orderId } = req.params;
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    console.log('✅ Confirming order after payment:', orderId);

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    const payment = await Payment.findOne({ razorpay_order_id });

    if (!payment || payment.status !== 'SUCCESS') {
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed',
      });
    }

    order.status = 'pending';
    order.paymentStatus = 'paid';
    order.razorpay_payment_id = razorpay_payment_id;
    await order.save();

    await order.populate('customer restaurant items.menuItem');

    console.log('✅ Order confirmed:', orderId);

    const orderSocketData = mapOrderToSocketData(order);
    activeOrdersPool.set(order._id.toString(), orderSocketData);
    console.log(`📦 Order added to pool from confirm. Pool size: ${activeOrdersPool.size}`);

    console.log(`📡 Emitting new_order_received to restaurant_${order.restaurant._id}`);
    io.to(`restaurant_${order.restaurant._id}`).emit('new_order_received', orderSocketData);

    res.json({
      success: true,
      order,
    });
  } catch (error) {
    console.error('❌ Error confirming order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to confirm order',
      error: error.message,
    });
  }
}

// @desc    Place a new order
// @route   POST /api/orders
// @access  Private
export async function placeOrderHandler(req, res) {
  try {
    const {
      customerId,
      restaurantId,
      items,
      deliveryAddress,
      paymentMethod,
      pricing,
      razorpay_order_id,
    } = req.body;

    console.log('📦 Received order request:', { customerId, restaurantId, items: items?.length, deliveryAddress, paymentMethod, pricing });

    if (paymentMethod === 'online') {
      if (!razorpay_order_id) {
        return res.status(400).json({
          success: false,
          message: 'Payment order ID is required for online payment',
        });
      }

      const payment = await Payment.findOne({ razorpay_order_id });

      if (!payment) {
        return res.status(400).json({
          success: false,
          message: 'Payment record not found',
        });
      }

      if (payment.status !== 'SUCCESS') {
        return res.status(400).json({
          success: false,
          message: 'Payment verification failed. Please complete the payment first.',
        });
      }

      console.log('✅ Payment verified for order placement:', razorpay_order_id);
    }

    console.log('💰 PRICING DATA RECEIVED FROM FRONTEND:');
    console.log('   Subtotal:', pricing?.subtotal);
    console.log('   Delivery Fee:', pricing?.deliveryFee);
    console.log('   Platform Fee:', pricing?.platformFee);
    console.log('   GST:', pricing?.gst);
    console.log('   Total:', pricing?.totalAmount);

    if (!customerId || !restaurantId || !items || !deliveryAddress || !paymentMethod || !pricing) {
      console.log('❌ VALIDATION FAILED - Missing fields');
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
    }

    const restaurant = await User.findById(restaurantId);
    console.log('🔍 Found user:', { id: restaurant?._id, role: restaurant?.role });

    if (!restaurant || restaurant.role !== 'restaurant') {
      console.log('❌ Restaurant validation failed');
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found',
      });
    }

    console.log('✅ Restaurant validated:', restaurant.restaurantDetails?.kitchenName);

    const isKitchenOpen = restaurant.restaurantDetails?.isKitchenOpen ?? true;

    if (!isKitchenOpen) {
      console.log('❌ Restaurant kitchen is closed');
      return res.status(400).json({
        success: false,
        message: 'This restaurant is currently closed and not accepting orders',
      });
    }

    console.log('📍 Delivery coordinates received:', {
      latitude: deliveryAddress.latitude,
      longitude: deliveryAddress.longitude,
      fullAddress: deliveryAddress.fullAddress
    });

    const orderData = {
      customer: customerId,
      restaurant: restaurantId,
      items,
      deliveryAddress: {
        fullAddress: deliveryAddress.fullAddress,
        latitude: Number(deliveryAddress.latitude),
        longitude: Number(deliveryAddress.longitude),
        street: deliveryAddress.street || '',
        city: deliveryAddress.city || '',
        state: deliveryAddress.state || '',
        zipCode: deliveryAddress.zipCode || '',
        country: deliveryAddress.country || ''
      },
      deliveryInstructions: deliveryAddress.instructions,
      paymentMethod,
      paymentStatus: paymentMethod === 'cod' ? 'pending' : 'paid',
      subtotal: pricing.subtotal,
      deliveryFee: pricing.deliveryFee,
      platformFee: pricing.platformFee,
      gst: pricing.gst,
      totalAmount: pricing.totalAmount,
    };

    if (paymentMethod === 'online' && razorpay_order_id) {
      const payment = await Payment.findOne({ razorpay_order_id });
      if (payment && payment.razorpay_payment_id) {
        orderData.razorpay_payment_id = payment.razorpay_payment_id;
      }
    }

    const order = new Order(orderData);
    await order.save();

    console.log('✅ Order saved successfully:', order._id);

    await order.populate([
      { path: 'customer', select: 'name email phone' },
      { path: 'restaurant', select: 'restaurantDetails' },
      { path: 'items.menuItem', select: 'name price image category' },
    ]);

    const orderSocketData = mapOrderToSocketData(order);
    activeOrdersPool.set(order._id.toString(), orderSocketData);

    console.log(`📦 Order added to pool. Pool size: ${activeOrdersPool.size}`);
    console.log(`🏪 Emitting to room: restaurant_${restaurantId}`);

    io.to(`restaurant_${restaurantId}`).emit('new_order_received', orderSocketData);

    io.to(`order_${order._id}`).emit('order_placed', {
      orderId: order._id,
      status: 'pending',
      message: 'Order placed successfully! Waiting for restaurant confirmation...',
    });

    console.log(`📦 Order socket created for order: ${order._id}`);

    res.status(201).json({
      success: true,
      message: 'Order placed successfully',
      order,
    });
  } catch (error) {
    console.error('❌ Error placing order:', error);
    res.status(500).json({
      success: false,
      message: 'Error placing order',
      error: error.message,
    });
  }
}

// @desc    Rider accepts an order
// @route   POST /api/orders/:id/accept
// @access  Private
export async function riderAcceptOrderHandler(req, res) {
  try {
    const { riderId } = req.body;
    const orderId = req.params.id;

    const order = await Order.findById(orderId).populate([
      { path: 'customer', select: 'name email phone' },
      { path: 'restaurant', select: 'restaurantDetails' },
    ]);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    const statusIsAvailable = order.status === 'awaiting_rider' || order.status === 'accepted';

    if (!statusIsAvailable || order.rider) {
      return res.status(400).json({
        success: false,
        message: 'Order has already been assigned or is not available',
      });
    }

    const rider = await User.findById(riderId);
    if (!rider || rider.role !== 'rider') {
      return res.status(404).json({
        success: false,
        message: 'Rider not found',
      });
    }

    order.rider = riderId;
    order.status = 'rider_assigned';
    order.acceptedAt = new Date();
    await order.save();

    activeRidersPool.forEach((otherRider) => {
      io.to(`rider_${otherRider.riderId}`).emit('order_taken', {
        orderId: order._id,
      });
    });

    io.to(`order_${order._id}`).emit('order_accepted', {
      orderId: order._id,
      status: 'rider_assigned',
      message: `Rider ${rider.name} accepted your order!`,
      riderName: rider.name,
      riderPhone: rider.phone,
    });

    io.to(`restaurant_${order.restaurant}`).emit('order_status_changed', {
      orderId: order._id,
      status: 'rider_assigned',
      riderName: rider.name,
      riderPhone: rider.phone,
    });

    res.status(200).json({
      success: true,
      message: 'Order accepted successfully',
      order,
    });
  } catch (error) {
    console.error('❌ Error accepting order:', error);
    res.status(500).json({
      success: false,
      message: 'Error accepting order',
      error: error.message,
    });
  }
}

// @desc    Verify pickup PIN before marking as picked up
// @route   POST /api/orders/:id/verify-pickup-pin
// @access  Private
export async function verifyPickupPinHandler(req, res) {
  try {
    const { pin } = req.body;
    const orderId = req.params.id;

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    if (order.pickupPin !== pin) {
      return res.status(400).json({
        success: false,
        message: 'Invalid pickup PIN',
      });
    }

    order.status = 'picked_up';
    order.pickedUpAt = new Date();
    await order.save();

    const poolKey = orderId.toString();
    const poolOrder = activeOrdersPool.get(poolKey);
    if (poolOrder) {
      poolOrder.status = 'picked_up';
      activeOrdersPool.set(poolKey, poolOrder);
    }

    await order.populate([
      { path: 'customer', select: 'name email phone' },
      { path: 'restaurant', select: 'restaurantDetails' },
      { path: 'rider', select: 'name phone' },
    ]);

    io.to(`order_${orderId}`).emit('order_status_changed', {
      orderId: order._id,
      status: 'picked_up',
      timestamp: new Date(),
      message: 'Rider has picked up your order',
    });

    io.to(`restaurant_${order.restaurant._id}`).emit('order_status_changed', {
      orderId: order._id,
      status: 'picked_up',
      timestamp: new Date(),
    });

    res.status(200).json({
      success: true,
      message: 'Pickup verified successfully',
      order,
    });
  } catch (error) {
    console.error('❌ Error verifying pickup PIN:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying pickup PIN',
      error: error.message,
    });
  }
}

// @desc    Verify delivery PIN before marking as delivered
// @route   POST /api/orders/:id/verify-delivery-pin
// @access  Private
export async function verifyDeliveryPinHandler(req, res) {
  try {
    const { pin } = req.body;
    const orderId = req.params.id;

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    if (order.deliveryPin !== pin) {
      return res.status(400).json({
        success: false,
        message: 'Invalid delivery PIN',
      });
    }

    order.status = 'delivered';
    order.deliveredAt = new Date();

    if (order.rider) {
      const rider = await User.findById(order.rider);
      if (rider && rider.role === 'rider') {
        const lastReset = new Date(rider.riderDetails.lastEarningsReset);
        const today = new Date();
        if (lastReset.toDateString() !== today.toDateString()) {
          rider.riderDetails.todayEarnings = 0;
          rider.riderDetails.lastEarningsReset = today;
        }

        rider.riderDetails.totalDeliveries = (rider.riderDetails.totalDeliveries || 0) + 1;
        rider.riderDetails.totalEarnings = (rider.riderDetails.totalEarnings || 0) + (order.riderEarnings || 0);
        rider.riderDetails.todayEarnings = (rider.riderDetails.todayEarnings || 0) + (order.riderEarnings || 0);

        await rider.save();
        console.log(`💰 Rider ${rider.name} earned ₹${order.riderEarnings}. Today: ₹${rider.riderDetails.todayEarnings}, Total: ₹${rider.riderDetails.totalEarnings}`);
      }
    }

    await order.save();

    await order.populate([
      { path: 'customer', select: 'name email phone' },
      { path: 'restaurant', select: 'restaurantDetails' },
      { path: 'rider', select: 'name phone' },
    ]);

    io.to(`order_${orderId}`).emit('order_status_changed', {
      orderId: order._id,
      status: 'delivered',
      timestamp: new Date(),
      message: 'Your order has been delivered',
    });

    io.to(`restaurant_${order.restaurant._id}`).emit('order_status_changed', {
      orderId: order._id,
      status: 'delivered',
      timestamp: new Date(),
    });

    if (order.rider) {
      io.to(`rider_${order.rider._id}`).emit('order_status_changed', {
        orderId: order._id,
        status: 'delivered',
        timestamp: new Date(),
      });
    }

    res.status(200).json({
      success: true,
      message: 'Delivery verified successfully',
      order,
    });
  } catch (error) {
    console.error('❌ Error verifying delivery PIN:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying delivery PIN',
      error: error.message,
    });
  }
}

// @desc    Update order status
// @route   PATCH /api/orders/:id/status
// @access  Private
export async function updateOrderStatusHandler(req, res) {
  try {
    const { status } = req.body;
    const orderId = req.params.id;

    const validStatuses = [
      'preparing',
      'ready',
      'picked_up',
      'on_the_way',
      'delivered',
      'cancelled',
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status',
      });
    }

    const order = await Order.findById(orderId).populate([
      { path: 'customer', select: 'name email phone' },
      { path: 'restaurant', select: 'restaurantDetails' },
      { path: 'rider', select: 'name phone' },
    ]);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    order.status = status;

    switch (status) {
      case 'preparing':
        order.preparingAt = new Date();
        break;
      case 'ready':
        order.readyAt = new Date();
        break;
      case 'picked_up':
        order.pickedUpAt = new Date();
        break;
      case 'on_the_way':
        order.onTheWayAt = new Date();
        break;
      case 'delivered':
        order.deliveredAt = new Date();

        if (order.rider) {
          const rider = await User.findById(order.rider);
          if (rider && rider.role === 'rider') {
            const lastReset = new Date(rider.riderDetails.lastEarningsReset);
            const today = new Date();
            if (lastReset.toDateString() !== today.toDateString()) {
              rider.riderDetails.todayEarnings = 0;
              rider.riderDetails.lastEarningsReset = today;
            }

            rider.riderDetails.totalDeliveries = (rider.riderDetails.totalDeliveries || 0) + 1;
            rider.riderDetails.totalEarnings = (rider.riderDetails.totalEarnings || 0) + (order.riderEarnings || 0);
            rider.riderDetails.todayEarnings = (rider.riderDetails.todayEarnings || 0) + (order.riderEarnings || 0);

            await rider.save();
          }
        }
        break;
      case 'cancelled':
        order.cancelledAt = new Date();
        break;
    }

    await order.save();

    const poolKey = orderId.toString();
    const poolOrder = activeOrdersPool.get(poolKey);
    if (status === 'delivered' || status === 'cancelled') {
      activeOrdersPool.delete(poolKey);
    } else if (poolOrder) {
      poolOrder.status = status;
      activeOrdersPool.set(poolKey, poolOrder);
    }

    // Notify customer tracking the order
    io.to(`order_${orderId}`).emit('order_status_changed', {
      orderId: order._id,
      status,
      timestamp: new Date(),
      message: getStatusMessage(status),
    });

    // Notify restaurant dashboard
    io.to(`restaurant_${order.restaurant._id}`).emit('order_status_changed', {
      orderId: order._id,
      status,
      timestamp: new Date(),
    });

    // Notify the assigned rider (so their app reflects status immediately)
    if (order.rider) {
      io.to(`rider_${order.rider._id || order.rider}`).emit('order_status_changed', {
        orderId: order._id,
        status,
        timestamp: new Date(),
        message: getStatusMessage(status),
      });
    }

    // When restaurant accepts → notify nearby riders so they see the new delivery opportunity
    if (status === 'accepted' || status === 'awaiting_rider') {
      await notifyNearbyRiders(order).catch(err =>
        console.error('❌ notifyNearbyRiders failed:', err)
      );
    }

    res.status(200).json({
      success: true,
      message: 'Order status updated',
      order,
    });
  } catch (error) {
    console.error('❌ Error updating order status:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating order status',
      error: error.message,
    });
  }
}

// @desc    Get customer orders
// @route   GET /api/orders/customer/:customerId
// @access  Private
export async function getCustomerOrdersHandler(req, res) {
  try {
    const { customerId } = req.params;

    const orders = await Order.find({
      customer: customerId,
      status: { $ne: 'pending_payment' }
    })
      .populate([
        { path: 'restaurant', select: 'restaurantDetails' },
        { path: 'rider', select: 'name phone' },
        { path: 'items.menuItem', select: 'name price' },
      ])
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      orders,
    });
  } catch (error) {
    console.error('❌ Error fetching customer orders:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching orders',
      error: error.message,
    });
  }
}

// @desc    Get all available orders (awaiting_rider status)
// @route   GET /api/orders/available
// @access  Private
export async function getAvailableOrdersHandler(req, res) {
  try {
    let { latitude, longitude } = req.query;
    const MAX_DISTANCE_KM = 1000;

    console.log(`📦 Fetching available orders from database`);

    if ((!latitude || !longitude) && req.user) {
      const riderData = activeRidersPool.get(req.user.toString());
      if (riderData && riderData.coordinates) {
        latitude = riderData.coordinates.latitude;
        longitude = riderData.coordinates.longitude;
      }
    }

    const orders = await Order.find({
      status: { $in: ['awaiting_rider', 'accepted'] },
      rider: null
    })
      .populate([
        { path: 'customer', select: 'name phone address' },
        { path: 'restaurant', select: 'restaurantDetails name' },
        { path: 'items.menuItem', select: 'name price image' },
      ])
      .sort({ createdAt: -1 })
      .limit(50);

    let filteredOrders = orders;

    if (latitude && longitude && !isNaN(parseFloat(latitude)) && !isNaN(parseFloat(longitude))) {
      const riderLat = parseFloat(latitude);
      const riderLon = parseFloat(longitude);

      filteredOrders = orders.filter(order => {
        const restaurant = order.restaurant;
        if (!restaurant?.restaurantDetails?.address?.latitude || !restaurant?.restaurantDetails?.address?.longitude) {
          return false;
        }

        const distance = calculateDistance(
          riderLat,
          riderLon,
          restaurant.restaurantDetails.address.latitude,
          restaurant.restaurantDetails.address.longitude
        );

        return distance <= MAX_DISTANCE_KM;
      });
    }

    const formattedOrders = filteredOrders.map(order => ({
      orderId: order._id,
      orderNumber: order.orderNumber,
      restaurantName: order.restaurant?.restaurantDetails?.kitchenName || order.restaurant?.name || 'Unknown',
      restaurantAddress: order.restaurant?.restaurantDetails?.address,
      customerName: order.customer?.name,
      customerPhone: order.customer?.phone,
      deliveryAddress: order.deliveryAddress,
      totalAmount: order.totalAmount,
      deliveryFee: order.deliveryFee,
      items: order.items,
      status: order.status,
      createdAt: order.createdAt,
      pickupPin: order.pickupPin,
      distanceToCustomer: order.distanceToCustomer,
    }));

    res.json({
      success: true,
      orders: formattedOrders,
    });
  } catch (error) {
    console.error('❌ Error fetching available orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch available orders',
      error: error.message,
    });
  }
}

// @desc    Get rider orders
// @route   GET /api/orders/rider/:riderId
// @access  Private
export async function getRiderOrdersHandler(req, res) {
  try {
    const { riderId } = req.params;

    const orders = await Order.find({ rider: riderId })
      .populate([
        { path: 'customer', select: 'name phone' },
        { path: 'restaurant', select: 'restaurantDetails' },
        { path: 'items.menuItem', select: 'name price' },
      ])
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      orders,
    });
  } catch (error) {
    console.error('❌ Error fetching rider orders:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching orders',
      error: error.message,
    });
  }
}

// @desc    Get order details
// @route   GET /api/orders/:id
// @access  Private
export async function getOrderByIdHandler(req, res) {
  try {
    const order = await Order.findById(req.params.id).populate([
      { path: 'customer', select: 'name email phone' },
      { path: 'restaurant', select: 'restaurantDetails' },
      { path: 'rider', select: 'name phone riderDetails' },
      { path: 'items.menuItem', select: 'name price' },
    ]);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    res.status(200).json({
      success: true,
      order,
    });
  } catch (error) {
    console.error('❌ Error fetching order:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching order',
      error: error.message,
    });
  }
}

// @desc    Update rider location
// @route   PATCH /api/orders/:id/rider-location
// @access  Private
export async function updateRiderLocationHandler(req, res) {
  try {
    const { latitude, longitude } = req.body;
    const orderId = req.params.id;

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    order.riderLocation = {
      latitude,
      longitude,
      lastUpdated: new Date(),
    };

    await order.save();

    io.to(`order_${orderId}`).emit('rider_location', {
      orderId,
      location: { latitude, longitude },
      timestamp: new Date(),
    });

    res.status(200).json({
      success: true,
      message: 'Rider location updated',
    });
  } catch (error) {
    console.error('❌ Error updating rider location:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating rider location',
      error: error.message,
    });
  }
}

// @desc    Get restaurant orders
// @route   GET /api/orders/restaurant/:restaurantId
// @access  Private
export async function getRestaurantOrdersHandler(req, res) {
  try {
    const { restaurantId } = req.params;

    const orders = await Order.find({
      restaurant: restaurantId,
      // Exclude ghost orders from failed/abandoned ONLINE payments:
      //  - status:'pending_payment' + online  → user started but never completed payment
      //  - paymentStatus:'failed'  + online   → payment was explicitly declined/cancelled
      // COD orders are NEVER excluded (paymentStatus='pending' is normal for COD —
      // it just means cash hasn't been collected yet, which the restaurant expects).
      $nor: [
        { status: 'pending_payment', paymentMethod: 'online' },
        { paymentStatus: 'failed',   paymentMethod: 'online' },
      ],
    })
      .populate([
        { path: 'customer', select: 'name phone' },
        { path: 'rider', select: 'name phone' },
        { path: 'items.menuItem', select: 'name price' },
      ])
      .sort({ createdAt: -1 })
      .limit(50);

    res.status(200).json({
      success: true,
      orders,
    });
  } catch (error) {
    console.error('❌ Error fetching restaurant orders:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching orders',
      error: error.message,
    });
  }
}

// ─────────────────────────────────────────────────────────────────
//  EXPRESS ROUTES (unchanged — API behaviour stays identical)
// ─────────────────────────────────────────────────────────────────

router.post('/pending', createPendingOrderHandler);
router.post('/:orderId/confirm', confirmOrderHandler);
router.post('/', placeOrderHandler);
router.post('/:id/accept', riderAcceptOrderHandler);
router.post('/:id/verify-pickup-pin', verifyPickupPinHandler);
router.post('/:id/verify-delivery-pin', verifyDeliveryPinHandler);
router.patch('/:id/status', updateOrderStatusHandler);
router.get('/customer/:customerId', getCustomerOrdersHandler);
router.get('/available', getAvailableOrdersHandler);
router.get('/rider/:riderId', getRiderOrdersHandler);
router.get('/:id', getOrderByIdHandler);
router.patch('/:id/rider-location', updateRiderLocationHandler);
router.get('/restaurant/:restaurantId', getRestaurantOrdersHandler);

export default router;