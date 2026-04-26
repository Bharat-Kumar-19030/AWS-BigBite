import express from 'express';
import Order from '../models/Order.js';
import User from '../models/User.js';

const router = express.Router();

// POST /api/rating/order/:orderId - Rate restaurant and rider after delivery
router.post('/order/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { restaurantRating, restaurantReview, riderRating, riderReview } = req.body;

    const order = await Order.findById(orderId).populate('restaurant rider');
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.status !== 'delivered') {
      return res.status(400).json({
        success: false,
        message: 'Can only rate delivered orders'
      });
    }

    // Update restaurant rating
    if (restaurantRating) {
      order.restaurantRating = {
        value: restaurantRating,
        review: restaurantReview || '',
        ratedAt: new Date()
      };

      const restaurant = await User.findById(order.restaurant._id);
      if (restaurant) {
        const currentAvg = restaurant.restaurantDetails.rating.average || 0;
        const currentCount = restaurant.restaurantDetails.rating.count || 0;
        
        const newCount = currentCount + 1;
        const newAvg = ((currentAvg * currentCount) + restaurantRating) / newCount;
        
        restaurant.restaurantDetails.rating = {
          average: Math.round(newAvg * 10) / 10, // Round to 1 decimal
          count: newCount
        };
        
        await restaurant.save();
      }
    }

    // Update rider rating
    if (riderRating && order.rider) {
      order.riderRating = {
        value: riderRating,
        review: riderReview || '',
        ratedAt: new Date()
      };

      const rider = await User.findById(order.rider._id);
      if (rider) {
        const currentAvg = rider.riderDetails.rating.average || 2.5;
        const currentCount = rider.riderDetails.rating.count || 0;
        
        const newCount = currentCount + 1;
        const newAvg = ((currentAvg * currentCount) + riderRating) / newCount;
        
        rider.riderDetails.rating = {
          average: Math.round(newAvg * 10) / 10, // Round to 1 decimal
          count: newCount
        };
        
        await rider.save();
      }
    }

    await order.save();

    res.json({
      success: true,
      message: 'Ratings submitted successfully',
      order
    });
  } catch (error) {
    console.error('Error submitting rating:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting rating',
      error: error.message
    });
  }
});

// GET /api/rating/restaurant/:restaurantId - Get restaurant ratings
router.get('/restaurant/:restaurantId', async (req, res) => {
  try {
    const restaurant = await User.findById(req.params.restaurantId);
    
    if (!restaurant || restaurant.role !== 'restaurant') {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    res.json({
      success: true,
      rating: restaurant.restaurantDetails.rating
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching rating',
      error: error.message
    });
  }
});


// ─── Exported handlers for the AI agent (chatbot.js) ─────────────

export async function submitRatingHandler(req, res) {
  try {
    const { orderId } = req.params;
    const { restaurantRating, restaurantReview, riderRating, riderReview } = req.body;

    const order = await Order.findById(orderId).populate('restaurant rider');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'delivered') {
      return res.status(400).json({ success: false, message: 'Can only rate delivered orders' });
    }

    if (restaurantRating) {
      order.restaurantRating = { value: restaurantRating, review: restaurantReview || '', ratedAt: new Date() };
      const restaurant = await User.findById(order.restaurant._id);
      if (restaurant) {
        const currentCount = restaurant.restaurantDetails.rating.count || 0;
        const currentAvg  = restaurant.restaurantDetails.rating.average || 0;
        const newCount = currentCount + 1;
        restaurant.restaurantDetails.rating = {
          average: Math.round(((currentAvg * currentCount) + restaurantRating) / newCount * 10) / 10,
          count: newCount,
        };
        await restaurant.save();
      }
    }

    if (riderRating && order.rider) {
      order.riderRating = { value: riderRating, review: riderReview || '', ratedAt: new Date() };
      const rider = await User.findById(order.rider._id);
      if (rider) {
        const currentCount = rider.riderDetails.rating.count || 0;
        const currentAvg  = rider.riderDetails.rating.average || 2.5;
        const newCount = currentCount + 1;
        rider.riderDetails.rating = {
          average: Math.round(((currentAvg * currentCount) + riderRating) / newCount * 10) / 10,
          count: newCount,
        };
        await rider.save();
      }
    }

    await order.save();
    res.json({ success: true, message: 'Ratings submitted successfully' });
  } catch (error) {
    console.error('Error submitting rating:', error);
    res.status(500).json({ success: false, message: 'Error submitting rating', error: error.message });
  }
}

export async function getRestaurantRatingHandler(req, res) {
  try {
    const restaurant = await User.findById(req.params.restaurantId);
    if (!restaurant || restaurant.role !== 'restaurant') {
      return res.status(404).json({ success: false, message: 'Restaurant not found' });
    }
    res.json({ success: true, rating: restaurant.restaurantDetails.rating });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching rating', error: error.message });
  }
}

export default router;
