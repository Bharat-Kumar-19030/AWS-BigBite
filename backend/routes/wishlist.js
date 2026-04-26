import express from 'express';
import Wishlist from '../models/Wishlist.js';
import User from '../models/User.js';
import MenuItem from '../models/MenuItem.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// ─────────────────────────────────────────────────────────────────
//  EXPORTED HANDLER FUNCTIONS  (used by chatbot.js agent tools)
// ─────────────────────────────────────────────────────────────────

// @desc    Get all wishlists for a user
// @route   GET /api/wishlist
// @access  Private
export async function getWishlistsHandler(req, res) {
  try {
    console.log('📝 Fetching wishlists for user:', req.user.id);
    const userId = req.user.id;

    const wishlists = await Wishlist.find({ user: userId })
      .populate('restaurant', 'restaurantDetails')
      .populate('items.menuItem', 'name price image category')
      .sort('-createdAt');

    console.log('📝 Found wishlists:', wishlists.length);

    res.status(200).json({
      success: true,
      count: wishlists.length,
      wishlists
    });
  } catch (error) {
    console.error('❌ Error fetching wishlists:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch wishlists',
      error: error.message
    });
  }
}

// @desc    Create new wishlist from cart
// @route   POST /api/wishlist
// @access  Private
export async function createWishlistHandler(req, res) {
  try {
    console.log('📝 Creating wishlist with body:', req.body);
    const { name, restaurant, items } = req.body;
    const userId = req.user.id;

    if (!name || !restaurant || !items || items.length === 0) {
      console.log('❌ Missing required fields');
      return res.status(400).json({
        success: false,
        message: 'Name, restaurant ID, and items are required'
      });
    }

    // Check if restaurant exists
    const restaurantDoc = await User.findById(restaurant);
    if (!restaurantDoc || restaurantDoc.role !== 'restaurant') {
      console.log('❌ Restaurant not found:', restaurant);
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    console.log('✅ Restaurant found:', restaurantDoc.restaurantDetails?.kitchenName);

    // Create wishlist
    const wishlist = new Wishlist({
      user: userId,
      name,
      restaurant: restaurant,
      items
    });

    await wishlist.save();
    console.log('✅ Wishlist saved:', wishlist._id);

    // Populate for response
    await wishlist.populate('restaurant', 'restaurantDetails');
    await wishlist.populate('items.menuItem', 'name price image category');

    res.status(201).json({
      success: true,
      message: 'Wishlist created successfully',
      wishlist
    });
  } catch (error) {
    console.error('❌ Error creating wishlist:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create wishlist',
      error: error.message
    });
  }
}

// @desc    Update wishlist name
// @route   PATCH /api/wishlist/:id/name
// @access  Private
export async function updateWishlistNameHandler(req, res) {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const userId = req.user.id;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Name is required'
      });
    }

    const wishlist = await Wishlist.findOne({ _id: id, user: userId });

    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: 'Wishlist not found'
      });
    }

    wishlist.name = name;
    wishlist.updatedAt = Date.now();
    await wishlist.save();

    res.status(200).json({
      success: true,
      message: 'Wishlist name updated',
      wishlist
    });
  } catch (error) {
    console.error('Error updating wishlist name:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update wishlist name',
      error: error.message
    });
  }
}

// @desc    Add item to wishlist
// @route   POST /api/wishlist/:id/items
// @access  Private
export async function addItemToWishlistHandler(req, res) {
  try {
    const { id } = req.params;
    const { menuItem, name, price, quantity } = req.body;
    const userId = req.user.id;

    const wishlist = await Wishlist.findOne({ _id: id, user: userId });

    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: 'Wishlist not found'
      });
    }

    // Verify menu item belongs to same restaurant
    const menuItemDoc = await MenuItem.findById(menuItem);
    if (!menuItemDoc || menuItemDoc.restaurant.toString() !== wishlist.restaurant.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Item must be from the same restaurant'
      });
    }

    // Check if item already exists
    const existingItem = wishlist.items.find(item =>
      item.menuItem.toString() === menuItem
    );

    if (existingItem) {
      existingItem.quantity += quantity || 1;
    } else {
      wishlist.items.push({ menuItem, name, price, quantity: quantity || 1 });
    }

    wishlist.updatedAt = Date.now();
    await wishlist.save();
    await wishlist.populate('items.menuItem', 'name price image category');

    res.status(200).json({
      success: true,
      message: 'Item added to wishlist',
      wishlist
    });
  } catch (error) {
    console.error('Error adding item to wishlist:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add item',
      error: error.message
    });
  }
}

// @desc    Update item quantity in wishlist
// @route   PATCH /api/wishlist/:id/items/:itemId
// @access  Private
export async function updateItemQuantityHandler(req, res) {
  try {
    const { id, itemId } = req.params;
    const { quantity } = req.body;
    const userId = req.user.id;

    if (!quantity || quantity < 1) {
      return res.status(400).json({
        success: false,
        message: 'Valid quantity is required'
      });
    }

    const wishlist = await Wishlist.findOne({ _id: id, user: userId });

    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: 'Wishlist not found'
      });
    }

    const item = wishlist.items.id(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found in wishlist'
      });
    }

    item.quantity = quantity;
    wishlist.updatedAt = Date.now();
    await wishlist.save();

    res.status(200).json({
      success: true,
      message: 'Item quantity updated',
      wishlist
    });
  } catch (error) {
    console.error('Error updating item quantity:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update item quantity',
      error: error.message
    });
  }
}

// @desc    Remove item from wishlist
// @route   DELETE /api/wishlist/:id/items/:itemId
// @access  Private
export async function removeItemFromWishlistHandler(req, res) {
  try {
    const { id, itemId } = req.params;
    const userId = req.user.id;

    const wishlist = await Wishlist.findOne({ _id: id, user: userId });

    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: 'Wishlist not found'
      });
    }

    wishlist.items.pull(itemId);
    wishlist.updatedAt = Date.now();
    await wishlist.save();

    res.status(200).json({
      success: true,
      message: 'Item removed from wishlist',
      wishlist
    });
  } catch (error) {
    console.error('Error removing item from wishlist:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove item',
      error: error.message
    });
  }
}

// @desc    Delete wishlist
// @route   DELETE /api/wishlist/:id
// @access  Private
export async function deleteWishlistHandler(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const wishlist = await Wishlist.findOneAndDelete({ _id: id, user: userId });

    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: 'Wishlist not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Wishlist deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting wishlist:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete wishlist',
      error: error.message
    });
  }
}

// @desc    Get single wishlist by ID
// @route   GET /api/wishlist/:id
// @access  Private
export async function getWishlistByIdHandler(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const wishlist = await Wishlist.findOne({ _id: id, user: userId })
      .populate('restaurant', 'restaurantDetails')
      .populate('items.menuItem', 'name price image category');

    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: 'Wishlist not found'
      });
    }

    res.status(200).json({
      success: true,
      wishlist
    });
  } catch (error) {
    console.error('Error fetching wishlist:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch wishlist',
      error: error.message
    });
  }
}

// ─────────────────────────────────────────────────────────────────
//  EXPRESS ROUTES  (unchanged — API behaviour stays identical)
// ─────────────────────────────────────────────────────────────────

router.get('/',                       protect, getWishlistsHandler);
router.post('/',                      protect, createWishlistHandler);
router.patch('/:id/name',             protect, updateWishlistNameHandler);
router.post('/:id/items',             protect, addItemToWishlistHandler);
router.patch('/:id/items/:itemId',    protect, updateItemQuantityHandler);
router.delete('/:id/items/:itemId',   protect, removeItemFromWishlistHandler);
router.delete('/:id',                 protect, deleteWishlistHandler);
router.get('/:id',                    protect, getWishlistByIdHandler);

export default router;