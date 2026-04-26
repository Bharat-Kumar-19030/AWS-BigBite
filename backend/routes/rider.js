import express from 'express';
import User from '../models/User.js';
import Order from '../models/Order.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// POST /api/rider/register - Register user as a rider
router.post('/register', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const { vehicleType, vehicleNumber, licenseNumber, aadharNumber, bankAccount, ifscCode } = req.body;

    // Validate required fields
    if (!vehicleType || !vehicleNumber || !licenseNumber || !aadharNumber || !bankAccount || !ifscCode) {
      return res.status(400).json({
        success: false,
        message: 'All rider details are required',
      });
    }

    // Get the user
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Check if already a rider
    if (user.role === 'rider') {
      return res.status(400).json({
        success: false,
        message: 'User is already registered as a rider',
      });
    }

    // Update user to rider role with details
    user.role = 'rider';
    user.riderDetails = {
      vehicleType,
      vehicleNumber,
      licenseNumber,
      aadharNumber,
      bankAccount,
      ifscCode,
      isVerified: false,
      isAvailable: true,
      totalDeliveries: 0,
      totalEarnings: 0,
      todayEarnings: 0,
      lastEarningsReset: new Date(),
      rating: {
        average: 2.5,
        count: 0
      }
    };

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Successfully registered as rider',
      data: {
        role: user.role,
        riderDetails: user.riderDetails,
      },
    });
  } catch (error) {
    console.error('❌ Error registering rider:', error);
    res.status(500).json({
      success: false,
      message: 'Error registering rider',
      error: error.message,
    });
  }
});

// GET /api/rider/stats - Get rider statistics
router.get('/stats', protect, async (req, res) => {
  try {
    const riderId = req.user.id;
    const rider = await User.findById(riderId);
    if (!rider || rider.role !== 'rider') {
      return res.status(404).json({ success: false, message: 'Rider not found' });
    }

    // ─── Lazy daily reset ─────────────────────────────────────────────
    const now = new Date();
    const lastReset = rider.riderDetails?.lastEarningsReset
      ? new Date(rider.riderDetails.lastEarningsReset)
      : null;
    const toDateStr = (d) => d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
    if (!lastReset || toDateStr(lastReset) !== toDateStr(now)) {
      rider.riderDetails.todayEarnings     = 0;
      rider.riderDetails.lastEarningsReset = now;
      await rider.save();
    }
    // ─────────────────────────────────────────────────────────────────

    const activeOrders = await Order.countDocuments({ 
      rider: riderId,
      status: { $in: ['rider_assigned', 'accepted', 'preparing', 'ready', 'picked_up', 'on_the_way'] }
    });

    res.status(200).json({
      success: true,
      data: {
        totalDeliveries: rider.riderDetails.totalDeliveries || 0,
        totalEarnings: rider.riderDetails.totalEarnings || 0,
        todayEarnings: rider.riderDetails.todayEarnings || 0,
        rating: rider.riderDetails.rating?.average || 2.5,
        ratingCount: rider.riderDetails.rating?.count || 0,
        activeOrders,
      },
    });
  } catch (error) {
    console.error('❌ Error fetching rider stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching rider stats',
      error: error.message,
    });
  }
});

// GET /api/rider/stats/:riderId - Get specific rider statistics
router.get('/stats/:riderId', async (req, res) => {
  try {
    const { riderId } = req.params;

    // Get rider user with stats
    const rider = await User.findById(riderId);
    
    if (!rider || rider.role !== 'rider') {
      return res.status(404).json({
        success: false,
        message: 'Rider not found',
      });
    }

    // Get active orders count - include all statuses where rider is actively working
    const activeOrders = await Order.countDocuments({ 
      rider: riderId,
      status: { $in: ['rider_assigned', 'accepted', 'preparing', 'ready', 'picked_up', 'on_the_way'] }
    });

    res.status(200).json({
      success: true,
      data: {
        totalDeliveries: rider.riderDetails.totalDeliveries || 0,
        totalEarnings: rider.riderDetails.totalEarnings || 0,
        todayEarnings: rider.riderDetails.todayEarnings || 0,
        rating: rider.riderDetails.rating?.average || 2.5,
        ratingCount: rider.riderDetails.rating?.count || 0,
        activeOrders,
      },
    });
  } catch (error) {
    console.error('❌ Error fetching rider stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching rider stats',
      error: error.message,
    });
  }
});



// PATCH /api/rider/availability - Toggle rider availability
router.patch('/availability', async (req, res) => {
  try {
    const { riderId, isAvailable } = req.body;

    const rider = await User.findById(riderId);
    
    if (!rider || rider.role !== 'rider') {
      return res.status(404).json({
        success: false,
        message: 'Rider not found',
      });
    }

    if (!rider.riderDetails) {
      rider.riderDetails = {};
    }

    rider.riderDetails.isAvailable = isAvailable;
    await rider.save();

    res.status(200).json({
      success: true,
      message: `Rider is now ${isAvailable ? 'available' : 'unavailable'}`,
      data: {
        isAvailable,
      },
    });
  } catch (error) {
    console.error('❌ Error updating rider availability:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating availability',
      error: error.message,
    });
  }
});

// PATCH /api/rider/location - Update rider location
router.patch('/location', async (req, res) => {
  try {
    const { riderId, latitude, longitude } = req.body;

    const rider = await User.findById(riderId);
    
    if (!rider || rider.role !== 'rider') {
      return res.status(404).json({
        success: false,
        message: 'Rider not found',
      });
    }

    if (!rider.riderDetails) {
      rider.riderDetails = {};
    }

    if (!rider.riderDetails.currentLocation) {
      rider.riderDetails.currentLocation = {};
    }

    rider.riderDetails.currentLocation.latitude = latitude;
    rider.riderDetails.currentLocation.longitude = longitude;
    rider.riderDetails.currentLocation.lastUpdated = new Date();
    
    await rider.save();

    res.status(200).json({
      success: true,
      message: 'Location updated successfully',
      data: {
        latitude,
        longitude,
      },
    });
  } catch (error) {
    console.error('❌ Error updating rider location:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating location',
      error: error.message,
    });
  }
});

// ─── Exported handlers for the AI agent (chatbot.js) ─────────────

export async function registerRiderHandler(req, res) {
  try {
    const userId = req.user.id;
    const { vehicleType, vehicleNumber, licenseNumber, aadharNumber, bankAccount, ifscCode } = req.body;
    if (!vehicleType || !vehicleNumber || !licenseNumber || !aadharNumber || !bankAccount || !ifscCode) {
      return res.status(400).json({ success: false, message: 'All rider details are required' });
    }
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role === 'rider') return res.status(400).json({ success: false, message: 'User is already registered as a rider' });
    user.role = 'rider';
    user.riderDetails = {
      vehicleType, vehicleNumber, licenseNumber, aadharNumber, bankAccount, ifscCode,
      isVerified: false, isAvailable: true, totalDeliveries: 0, totalEarnings: 0,
      todayEarnings: 0, lastEarningsReset: new Date(), rating: { average: 2.5, count: 0 },
    };
    await user.save();
    res.status(200).json({ success: true, message: 'Successfully registered as rider', data: { role: user.role, riderDetails: user.riderDetails } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error registering rider', error: error.message });
  }
}

export async function getRiderStatsHandler(req, res) {
  try {
    const riderId = req.user.id;
    const rider = await User.findById(riderId);
    if (!rider || rider.role !== 'rider') return res.status(404).json({ success: false, message: 'Rider not found' });

    // ─── Lazy daily reset: zero todayEarnings at the start of each new calendar day ──
    const now = new Date();
    const lastReset = rider.riderDetails?.lastEarningsReset
      ? new Date(rider.riderDetails.lastEarningsReset)
      : null;

    const toDateString = (d) =>
      d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }); // 'DD/MM/YYYY' in IST

    const needsReset = !lastReset || toDateString(lastReset) !== toDateString(now);

    if (needsReset) {
      rider.riderDetails.todayEarnings    = 0;
      rider.riderDetails.lastEarningsReset = now;
      await rider.save();
    }
    // ────────────────────────────────────────────────────────────────────────────────

    const activeOrders = await Order.countDocuments({
      rider: riderId,
      status: { $in: ['rider_assigned', 'accepted', 'preparing', 'ready', 'picked_up', 'on_the_way'] },
    });
    res.status(200).json({
      success: true,
      data: {
        totalDeliveries: rider.riderDetails.totalDeliveries || 0,
        totalEarnings:   rider.riderDetails.totalEarnings   || 0,
        todayEarnings:   rider.riderDetails.todayEarnings   || 0,
        rating:          rider.riderDetails.rating?.average || 2.5,
        ratingCount:     rider.riderDetails.rating?.count   || 0,
        activeOrders,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching rider stats', error: error.message });
  }
}


export async function toggleRiderAvailabilityHandler(req, res) {
  try {
    const riderId = req.user.id;
    const { isAvailable } = req.body;
    const rider = await User.findById(riderId);
    if (!rider || rider.role !== 'rider') return res.status(404).json({ success: false, message: 'Rider not found' });
    if (!rider.riderDetails) rider.riderDetails = {};
    rider.riderDetails.isAvailable = isAvailable;
    await rider.save();
    res.status(200).json({ success: true, message: `Rider is now ${isAvailable ? 'available' : 'unavailable'}`, data: { isAvailable } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error updating availability', error: error.message });
  }
}

export async function updateRiderLocationHandler(req, res) {
  try {
    const riderId = req.user.id;
    const { latitude, longitude } = req.body;
    const rider = await User.findById(riderId);
    if (!rider || rider.role !== 'rider') return res.status(404).json({ success: false, message: 'Rider not found' });
    if (!rider.riderDetails) rider.riderDetails = {};
    if (!rider.riderDetails.currentLocation) rider.riderDetails.currentLocation = {};
    rider.riderDetails.currentLocation.latitude  = latitude;
    rider.riderDetails.currentLocation.longitude = longitude;
    rider.riderDetails.currentLocation.lastUpdated = new Date();
    await rider.save();
    res.status(200).json({ success: true, message: 'Location updated successfully', data: { latitude, longitude } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error updating location', error: error.message });
  }
}

export default router;
