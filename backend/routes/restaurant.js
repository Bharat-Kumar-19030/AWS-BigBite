import express from 'express';
import MenuItem from '../models/MenuItem.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// ─────────────────────────────────────────────────────────────────
//  EXPORTED HANDLER FUNCTIONS  (used by chatbot.js agent tools)
// ─────────────────────────────────────────────────────────────────

// @desc    Get all menu items for a restaurant
// @route   GET /api/restaurant/menu
// @access  Private (Restaurant owner)
export async function getMenuItemsHandler(req, res) {
  try {
    if (req.user.role !== 'restaurant') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only restaurant owners can access menu items.',
      });
    }

    const menuItems = await MenuItem.find({ restaurantId: req.user._id }).sort({
      createdAt: -1,
    });

    res.status(200).json({
      success: true,
      count: menuItems.length,
      data: menuItems,
    });
  } catch (error) {
    console.error('❌ Error fetching menu items:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch menu items',
      error: error.message,
    });
  }
}

// @desc    Create a new menu item
// @route   POST /api/restaurant/menu
// @access  Private (Restaurant owner)
export async function createMenuItemHandler(req, res) {
  try {
    if (req.user.role !== 'restaurant') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only restaurant owners can create menu items.',
      });
    }

    const { name, description, price, category, cuisine, subCategory, image, isVeg, isAvailable } = req.body;

    if (!name || !description || !price || !category || !cuisine || !image) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: name, description, price, category, cuisine, image',
      });
    }

    const user = await User.findById(req.user._id);
    const restaurantLocation = {
      latitude: user.restaurantDetails?.address?.latitude,
      longitude: user.restaurantDetails?.address?.longitude,
    };

    const menuItem = await MenuItem.create({
      restaurantId: req.user._id,
      name,
      description,
      price: Number(price),
      category,
      cuisine,
      subCategory,
      image,
      isVeg: isVeg !== undefined ? isVeg : true,
      isAvailable: isAvailable !== undefined ? isAvailable : true,
      restaurantLocation,
    });

    res.status(201).json({
      success: true,
      message: 'Menu item created successfully',
      data: menuItem,
    });
  } catch (error) {
    console.error('❌ Error creating menu item:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create menu item',
      error: error.message,
    });
  }
}

// @desc    Update a menu item
// @route   PUT /api/restaurant/menu/:id
// @access  Private (Restaurant owner)
export async function updateMenuItemHandler(req, res) {
  try {
    if (req.user.role !== 'restaurant') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only restaurant owners can update menu items.',
      });
    }

    const menuItem = await MenuItem.findById(req.params.id);

    if (!menuItem) {
      return res.status(404).json({
        success: false,
        message: 'Menu item not found',
      });
    }

    if (menuItem.restaurantId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only update your own menu items.',
      });
    }

    const { name, description, price, category, cuisine, subCategory, image, isVeg, isAvailable } = req.body;

    if (name !== undefined) menuItem.name = name;
    if (description !== undefined) menuItem.description = description;
    if (price !== undefined) menuItem.price = Number(price);
    if (category !== undefined) menuItem.category = category;
    if (cuisine !== undefined) menuItem.cuisine = cuisine;
    if (subCategory !== undefined) menuItem.subCategory = subCategory;
    if (image !== undefined) menuItem.image = image;
    if (isVeg !== undefined) menuItem.isVeg = isVeg;
    if (isAvailable !== undefined) menuItem.isAvailable = isAvailable;

    await menuItem.save();

    res.status(200).json({
      success: true,
      message: 'Menu item updated successfully',
      data: menuItem,
    });
  } catch (error) {
    console.error('❌ Error updating menu item:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update menu item',
      error: error.message,
    });
  }
}

// @desc    Delete a menu item
// @route   DELETE /api/restaurant/menu/:id
// @access  Private (Restaurant owner)
export async function deleteMenuItemHandler(req, res) {
  try {
    if (req.user.role !== 'restaurant') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only restaurant owners can delete menu items.',
      });
    }

    const menuItem = await MenuItem.findById(req.params.id);

    if (!menuItem) {
      return res.status(404).json({
        success: false,
        message: 'Menu item not found',
      });
    }

    if (menuItem.restaurantId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only delete your own menu items.',
      });
    }

    await MenuItem.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Menu item deleted successfully',
    });
  } catch (error) {
    console.error('❌ Error deleting menu item:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete menu item',
      error: error.message,
    });
  }
}

// @desc    Toggle kitchen open/close status
// @route   PUT /api/restaurant/toggle-kitchen
// @access  Private (Restaurant owner)
export async function toggleKitchenHandler(req, res) {
  try {
    if (req.user.role !== 'restaurant') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only restaurant owners can toggle kitchen status.',
      });
    }

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const currentStatus = user.restaurantDetails?.isKitchenOpen ?? true;

    if (currentStatus) {
      const activeOrders = await Order.countDocuments({
        restaurant: user._id,
        status: { $in: ['pending', 'accepted', 'rider_assigned', 'preparing', 'ready', 'picked_up', 'on_the_way'] },
      });

      if (activeOrders > 0) {
        return res.status(400).json({
          success: false,
          message: `Cannot close kitchen. You have ${activeOrders} active order(s). Please complete all orders before closing.`,
          activeOrders,
        });
      }
    }

    if (!user.restaurantDetails) {
      user.restaurantDetails = {};
    }

    user.restaurantDetails.isKitchenOpen = !currentStatus;
    user.markModified('restaurantDetails');
    await user.save();

    res.status(200).json({
      success: true,
      message: `Kitchen ${!currentStatus ? 'opened' : 'closed'} successfully`,
      isKitchenOpen: !currentStatus,
    });
  } catch (error) {
    console.error('❌ Error toggling kitchen status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle kitchen status',
      error: error.message,
    });
  }
}

// @desc    Get all restaurants filtered by location
// @route   GET /api/restaurant/all?latitude=LAT&longitude=LON&maxDistance=25
// @access  Public
export async function getAllRestaurantsHandler(req, res) {
  try {
    const { latitude, longitude, maxDistance = 25 } = req.query;

    const calculateDistance = (lat1, lon1, lat2, lon2) => {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    };

    const restaurants = await User.find({ role: 'restaurant' }).select(
      'name avatar restaurantDetails'
    );

    let restaurantsWithMenu = await Promise.all(
      restaurants.map(async (restaurant) => {
        const menuItems = await MenuItem.find({
          restaurantId: restaurant._id,
          isAvailable: true,
        });

        return {
          id: restaurant._id,
          name: restaurant.restaurantDetails?.kitchenName || restaurant.name,
          avatar: restaurant.avatar,
          cuisine: restaurant.restaurantDetails?.cuisine || '',
          description: restaurant.restaurantDetails?.description || '',
          address: restaurant.restaurantDetails?.address || {},
          isKitchenOpen: restaurant.restaurantDetails?.isKitchenOpen ?? true,
          restaurantDetails: {
            kitchenName: restaurant.restaurantDetails?.kitchenName || restaurant.name,
            rating: restaurant.restaurantDetails?.rating || { average: 0, count: 0 },
          },
          menuItems,
          menuCount: menuItems.length,
        };
      })
    );

    restaurantsWithMenu = restaurantsWithMenu.filter(r => r.menuCount > 0);

    if (latitude && longitude) {
      const userLat = parseFloat(latitude);
      const userLon = parseFloat(longitude);
      const maxDist = parseFloat(maxDistance);

      console.log('🎯 Backend - Filtering restaurants by location:', {
        userCoords: { latitude: userLat, longitude: userLon },
        maxDistance: maxDist,
        totalRestaurants: restaurantsWithMenu.length,
      });

      const filteredResults = [];
      restaurantsWithMenu.forEach(restaurant => {
        const restLat = restaurant.address?.latitude;
        const restLon = restaurant.address?.longitude;

        if (!restLat || !restLon) {
          console.log(`❌ ${restaurant.name} - No coordinates:`, restaurant.address);
          return;
        }

        const distance = calculateDistance(userLat, userLon, restLat, restLon);
        console.log(`📏 ${restaurant.name} - Distance: ${distance.toFixed(2)}km`, {
          restaurantCoords: { latitude: restLat, longitude: restLon },
          withinRange: distance <= maxDist,
        });

        if (distance <= maxDist) {
          filteredResults.push(restaurant);
        }
      });

      restaurantsWithMenu = filteredResults;
      console.log(`✅ Found ${filteredResults.length} restaurants within ${maxDist}km`);
    }

    res.status(200).json({
      success: true,
      count: restaurantsWithMenu.length,
      data: restaurantsWithMenu,
    });
  } catch (error) {
    console.error('❌ Error fetching restaurants:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch restaurants',
      error: error.message,
    });
  }
}

// ─────────────────────────────────────────────────────────────────
//  EXPRESS ROUTES  (unchanged — API behaviour stays identical)
// ─────────────────────────────────────────────────────────────────

router.get('/menu',             protect, getMenuItemsHandler);
router.post('/menu',            protect, createMenuItemHandler);
router.put('/menu/:id',         protect, updateMenuItemHandler);
router.delete('/menu/:id',      protect, deleteMenuItemHandler);
router.put('/toggle-kitchen',   protect, toggleKitchenHandler);
router.get('/all',                       getAllRestaurantsHandler);

export default router;