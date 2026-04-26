import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import LocationPicker from './LocationPicker';
import axios from 'axios';
import heart from '../assets/heart.png';
import fallbackImg from '../assets/fallback.jpg';
import { encryptPaymentData } from '../utils/encryption';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ;

const ViewCart = () => {
  const { cart, updateQuantity, removeFromCart, clearCart, calculateDistance } = useApp();
  const { user, setShowLoginModal } = useAuth();
  const { socket } = useSocket();
//   console.log(user);
  const navigate = useNavigate();
  
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryCoordinates, setDeliveryCoordinates] = useState(null);
  const [deliveryInstructions, setDeliveryInstructions] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cod'); // 'cod' or 'online'
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [tempAddress, setTempAddress] = useState(null);
  const [showWishlistModal, setShowWishlistModal] = useState(false);
  const [wishlistName, setWishlistName] = useState('');
  const [paymentTabOpen, setPaymentTabOpen] = useState(false); // Show overlay when payment tab is open
  const paymentTabRef = useRef(null); // Reference to the opened payment tab

  // Pricing constants
  const PLATFORM_FEE = 5;
  const GST_RATE = 0.05; // 5%
  const DELIVERY_FEE_PER_KM = 8; // ₹8 per km
  const FREE_DELIVERY_THRESHOLD = 500;

  // Calculate delivery fee based on distance
  const calculateDeliveryFee = () => {
    // If no delivery coordinates or no cart items, use default
    if (!deliveryCoordinates || cart.length === 0) {
      console.log('⚠️ Using default delivery fee (no coordinates or empty cart)');
      return 40; // Default fallback
    }

    // Get restaurant location from first cart item
    const restaurantAddress = cart[0]?.restaurantId?.restaurantDetails?.address;
    
    if (!restaurantAddress?.latitude || !restaurantAddress?.longitude) {
      console.log('⚠️ Using default delivery fee (no restaurant coordinates)');
      return 40; // Default if restaurant coordinates not available
    }

    // Calculate distance
    const distance = calculateDistance(
      deliveryCoordinates.latitude,
      deliveryCoordinates.longitude,
      restaurantAddress.latitude,
      restaurantAddress.longitude
    );

    // Calculate fee: ₹8 per km, rounded up
    const fee = Math.ceil(distance * DELIVERY_FEE_PER_KM);
    console.log(`💰 Calculated delivery fee: ₹${fee} (${distance.toFixed(2)} km × ₹${DELIVERY_FEE_PER_KM})`);
    return fee;
  };

  // Calculate totals
  const subtotal = cart.reduce((total, item) => {
    const price = item.menuItem?.price || item.price || 0;
    const quantity = item.quantity || 0;
    return total + (price * quantity);
  }, 0);
  const deliveryFee = subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : calculateDeliveryFee();
  const gst = subtotal * GST_RATE;
  const total = subtotal + deliveryFee + PLATFORM_FEE + gst;
  useEffect(() => {
    if (user?.address) {
      const { street, city, state, zipCode, latitude, longitude } = user.address;
      if (street && city && state && zipCode) {
        setDeliveryAddress(`${street}, ${city}, ${state} - ${zipCode}`);
        if (latitude && longitude) {
          setDeliveryCoordinates({ latitude, longitude });
        }
      } else if (user?.restaurantDetails?.address) {
        const { street: rStreet, city: rCity, state: rState, zipCode: rZipCode, latitude, longitude } = user.restaurantDetails.address;
        if (rStreet && rCity && rState && rZipCode) {
          setDeliveryAddress(`${rStreet}, ${rCity}, ${rState} - ${rZipCode}`);
          if (latitude && longitude) {
            setDeliveryCoordinates({ latitude, longitude });
          }
        }
      }
    }
  }, [user]);

  const handleLocationSelect = (addressData) => {
    if (!addressData) return;
    
    const { street, city, state, zipCode, latitude, longitude } = addressData;
    
    console.log('📍 handleLocationSelect - Address Data:', addressData);
    console.log('📍 handleLocationSelect - Cart:', cart);
    
    // ALWAYS validate distance if we have coordinates and cart items
    if (latitude && longitude && cart.length > 0) {
      // Get restaurant location from first cart item
      const firstCartItem = cart[0];
      console.log('📍 First cart item:', firstCartItem);
      
      const restaurantAddress = firstCartItem?.restaurantId?.restaurantDetails?.address;
      console.log('📍 Restaurant address:', restaurantAddress);
      
      if (restaurantAddress?.latitude && restaurantAddress?.longitude) {
        // Calculate distance between new delivery location and restaurant
        const distance = calculateDistance(
          latitude,
          longitude,
          restaurantAddress.latitude,
          restaurantAddress.longitude
        );
        
        console.log(`📏 Distance calculated: ${distance.toFixed(2)}km`);
        
        // Check if distance exceeds 25km - REJECT IMMEDIATELY
        if (distance > 25) {
          toast.error(
            `This location is ${distance.toFixed(1)}km away from the restaurant. Please select a location within 25km radius.`,
            { duration: 5000 }
          );
          console.log('❌ Location rejected - too far! NOT updating any state.');
          // Exit without updating ANY state or closing modal
          return;
        }
        
        console.log('✅ Distance validation passed');
      } else {
        console.warn('⚠️ Restaurant coordinates not available, skipping distance check');
      }
    }
    
    // Only reach here if distance validation passed or was skipped
    console.log('📝 Updating delivery location...');
    setTempAddress(addressData);
    
    // Check if we have complete address details
    if (street && city && state && zipCode) {
      setDeliveryAddress(`${street}, ${city}, ${state} - ${zipCode}`);
      console.log('✅ Full address updated');
    } else if (latitude && longitude) {
      // If we only have coordinates, use fallback message
      setDeliveryAddress('No worries, we got your coordinates!');
      console.log('✅ Coordinates-only address updated');
    }
    
    // Always save coordinates if available
    if (latitude && longitude) {
      setDeliveryCoordinates({ latitude, longitude });
    }
    
    setShowLocationPicker(false);
    toast.success('Delivery location updated successfully!');
  };

  const handleQuantityChange = (itemId, change) => {
    const item = cart.find(i => (i.menuItem?._id || i._id) === itemId);
    if (item) {
      const newQuantity = item.quantity + change;
      if (newQuantity > 0) {
        updateQuantity(itemId, newQuantity);
      }
    }
  };

  const handleCheckout = () => {
    if (!user) {
      setShowLoginModal(true);
      return;
    }

    if (!deliveryAddress && !deliveryCoordinates) {
      alert('Please add a delivery address or select a location on the map');
      setShowLocationPicker(true);
      return;
    }

    setShowCheckoutModal(true);
  };

  const handlePlaceOrder = async () => {
    try {
      if (!user || !user.id) {
        toast.error('Please login to place order');
        setShowLoginModal(true);
        return;
      }

      if (!deliveryAddress || !deliveryCoordinates) {
        toast.error('Please select a delivery address');
        return;
      }

      // Debug: Log cart structure
      console.log('📦 Cart for order placement:', cart);
      console.log('📦 First cart item:', cart[0]);
      console.log('📦 First cart item keys:', Object.keys(cart[0]));
      console.log('📦 restaurantId field:', cart[0]?.restaurantId);
      console.log('📦 restaurantId type:', typeof cart[0]?.restaurantId);

      // Get restaurant ID - handle both possible structures
      let restaurantId;
      
      // If restaurantId is an object (populated)
      if (cart[0]?.restaurantId && typeof cart[0].restaurantId === 'object') {
        restaurantId = cart[0].restaurantId._id;
      } 
      // If restaurantId is a string
      else if (typeof cart[0]?.restaurantId === 'string') {
        restaurantId = cart[0].restaurantId;
      }
      // Fallback to restaurantDetails
      else if (cart[0]?.restaurantDetails?._id) {
        restaurantId = cart[0].restaurantDetails._id;
      }

      console.log('📦 Extracted restaurantId:', restaurantId);

      if (!restaurantId) {
        toast.error('Restaurant information missing');
        console.error('❌ Cannot find restaurant ID in cart:', cart[0]);
        return;
      }

      // CRITICAL: Validate delivery distance before placing order
      const restaurantAddress = cart[0]?.restaurantId?.restaurantDetails?.address;
      const restaurantDetails = cart[0]?.restaurantId?.restaurantDetails;
      
      // Check if restaurant is open
      const isKitchenOpen = restaurantDetails?.isKitchenOpen ?? true;
      
      if (!isKitchenOpen) {
        toast.error(
          'This restaurant is currently closed. You cannot place an order at this time.',
          { duration: 5000 }
        );
        setShowCheckoutModal(false);
        return;
      }
      
      if (restaurantAddress?.latitude && restaurantAddress?.longitude && 
          deliveryCoordinates?.latitude && deliveryCoordinates?.longitude) {
        
        const distance = calculateDistance(
          deliveryCoordinates.latitude,
          deliveryCoordinates.longitude,
          restaurantAddress.latitude,
          restaurantAddress.longitude
        );
        
        console.log(`📏 Final distance check: ${distance.toFixed(2)}km`);
        
        // Reject if distance exceeds 25km
        if (distance > 25) {
          toast.error(
            `Your delivery location is ${distance.toFixed(1)}km away from the restaurant. We only deliver within 25km radius. Please select a closer delivery location.`,
            { duration: 6000 }
          );
          setShowCheckoutModal(false);
          return;
        }
        
        console.log('✅ Distance validation passed for order placement');
      } else {
        toast.error('Unable to verify delivery distance. Please select a valid delivery location.');
        console.error('❌ Missing coordinates:', { 
          restaurantAddress, 
          deliveryCoordinates 
        });
        setShowCheckoutModal(false);
        return;
      }

      // Prepare order data
      const orderData = {
        customerId: user.id,
        restaurantId: restaurantId,
        items: cart.map(item => {
          const menuItemId = item.menuItem?._id || item.menuItem || item.menuItemId || item._id;
          console.log('📦 Mapping cart item:', { 
            original: item, 
            extractedMenuItemId: menuItemId,
            'item.menuItem': item.menuItem,
            'item.menuItem._id': item.menuItem?._id,
            'item.menuItemId': item.menuItemId,
            'item._id': item._id
          });
          return {
            menuItem: menuItemId,
            name: item.name || item.menuItem?.name,
            price: item.price || item.menuItem?.price,
            quantity: item.quantity,
          };
        }),
        deliveryAddress: {
          fullAddress: deliveryAddress,
          latitude: Number(deliveryCoordinates.latitude),
          longitude: Number(deliveryCoordinates.longitude),
          instructions: deliveryInstructions || '',
        },
        paymentMethod,
        pricing: {
          subtotal,
          deliveryFee: deliveryFee,
          platformFee: PLATFORM_FEE,
          gst: gst,
          totalAmount: total,
        },
      };

      console.log('💰 PRICING BREAKDOWN BEING SENT TO BACKEND:');
      console.log('   Subtotal:', subtotal);
      console.log('   Delivery Fee:', deliveryFee);
      console.log('   Platform Fee:', PLATFORM_FEE);
      console.log('   GST:', gst);
      console.log('   Total:', total);

      // Handle online payment with Razorpay
      if (paymentMethod === 'online') {
        await handleOnlinePayment(orderData);
        return;
      }

      // COD Payment - Place order directly
      toast.loading('Placing your order...', { id: 'place-order' });

      // Import api service
      const { default: api } = await import('../services/api.js');
      
      const response = await api.placeOrder(orderData);

      if (response.success) {
        toast.success('Order placed successfully! 🎉', { id: 'place-order' });
        
        // Listen for order updates via socket
        if (socket) {
          socket.on('order_placed', (data) => {
            toast.success(data.message);
          });
        }

        // Clear cart and close modal
        clearCart();
        setShowCheckoutModal(false);
        
        // Navigate to orders page
        navigate('/orders');
      }
    } catch (error) {
      console.error('Error placing order:', error);
      toast.error(error.message || 'Failed to place order. Please try again.', {
        id: 'place-order',
      });
    }
  };

  // Handle incoming postMessage from the payment tab
  const handlePaymentMessage = useCallback((event) => {
    // Accept messages from the approved payment site
    const allowedOrigin = 'https://bharat-kumar-19030.github.io';
    if (event.origin !== allowedOrigin) return;

    const { type, status, ref, razorpay_order_id, razorpay_payment_id, razorpay_signature } = event.data || {};
    if (type !== 'PAYMENT_RESULT') return;

    console.log('📨 Payment result received from tab:', event.data);

    // Clean up listener & overlay
    setPaymentTabOpen(false);
    paymentTabRef.current = null;

    // Build the callback URL and navigate in the main tab
    const params = new URLSearchParams();
    params.set('payment', status);
    params.set('ref', ref);
    if (status === 'success') {
      if (razorpay_order_id) params.set('razorpay_order_id', razorpay_order_id);
      if (razorpay_payment_id) params.set('razorpay_payment_id', razorpay_payment_id);
      if (razorpay_signature) params.set('razorpay_signature', razorpay_signature);
    }

    navigate(`/payment-callback?${params.toString()}`);
  }, [navigate]);

  // Register / clean up the message listener
  useEffect(() => {
    window.addEventListener('message', handlePaymentMessage);
    return () => window.removeEventListener('message', handlePaymentMessage);
  }, [handlePaymentMessage]);

  // Handle Razorpay payment — open in a new tab instead of redirecting
  const handleOnlinePayment = async (orderData) => {
    try {
      toast.loading('Preparing payment...', { id: 'payment' });

      // Import api service
      const { default: api } = await import('../services/api.js');

      // First, create a pending order in database to get order ID
      const pendingOrderResponse = await api.createPendingOrder(orderData);

      if (!pendingOrderResponse.success) {
        throw new Error('Failed to create order');
      }

      const orderId = pendingOrderResponse.order._id;
      const totalAmount = orderData.pricing.totalAmount;

      toast.dismiss('payment');

      // Store order data temporarily in sessionStorage for return
      sessionStorage.setItem('pendingOrder', JSON.stringify({
        orderId,
        totalAmount,
        orderData
      }));

      // Approved Razorpay site URL
      const approvedSiteUrl = 'https://bharat-kumar-19030.github.io/Learno-Hub/payment.html';
      // returnUrl is no longer used for redirect — kept in payload for backward compat
      const returnUrl = window.location.origin + '/payment-callback';

      const paymentData = {
        amount: totalAmount,
        ref: orderId,
        returnUrl,
        timestamp: Date.now(),
      };

      const encryptedData = await encryptPaymentData(paymentData);
      const paymentUrl = `${approvedSiteUrl}?data=${encodeURIComponent(encryptedData)}&backend=${encodeURIComponent(SERVER_URL)}`;

      console.log('🪟 Opening payment in a new tab...');

      // Open payment page in a new tab — main tab stays on cart
      const paymentTab = window.open(paymentUrl, '_blank');
      paymentTabRef.current = paymentTab;

      if (!paymentTab) {
        // Popup blocked — fall back to same-tab redirect
        toast.error('Popup was blocked by your browser. Redirecting in the same tab...', { duration: 3000 });
        setTimeout(() => { window.location.href = paymentUrl; }, 3000);
        return;
      }

      // Close the checkout modal and show the "payment in progress" overlay
      setShowCheckoutModal(false);
      setPaymentTabOpen(true);
      toast.success('Payment page opened in a new tab! Complete your payment there.', { duration: 5000 });

    } catch (error) {
      console.error('Error in online payment:', error);
      toast.error(error.message || 'Payment initialization failed', {
        id: 'payment',
      });
    }
  };

  const handleSaveToWishlist = async () => {
    if (!user) {
      setShowLoginModal(true);
      return;
    }

    if (!wishlistName.trim()) {
      toast.error('Please enter a name for your wishlist');
      return;
    }

    try {
      // Get restaurant ID from cart
      let restaurantId;
      if (cart[0]?.restaurantId && typeof cart[0].restaurantId === 'object') {
        restaurantId = cart[0].restaurantId._id;
      } else if (typeof cart[0]?.restaurantId === 'string') {
        restaurantId = cart[0].restaurantId;
      } else if (cart[0]?.restaurantDetails?._id) {
        restaurantId = cart[0].restaurantDetails._id;
      }

      if (!restaurantId) {
        toast.error('Could not identify restaurant');
        return;
      }

      // Prepare items
      const items = cart.map(item => {
        const menuItem = item.menuItem || item;
        return {
          menuItem: menuItem._id || item._id,
          name: menuItem.name,
          price: menuItem.price,
          quantity: item.quantity
        };
      });

      toast.loading('Saving to wishlist...', { id: 'save-wishlist' });

      const token = localStorage.getItem('bigbite_token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await axios.post(
        `${SERVER_URL}/api/wishlist`,
        {
          name: wishlistName,
          restaurant: restaurantId,
          items
        },
        { headers }
      );

      if (response.data.success) {
        toast.success('Cart saved to wishlist! 💝', { id: 'save-wishlist' });
        setShowWishlistModal(false);
        setWishlistName('');
      }
    } catch (error) {
      console.error('Error saving wishlist:', error);
      toast.error(error.response?.data?.message || 'Failed to save wishlist', { id: 'save-wishlist' });
    }
  };

  if (cart.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 pt-24 pb-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-20"
          >
            <svg
              className="w-32 h-32 mx-auto text-gray-300 mb-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            <h2 className="text-3xl font-bold text-gray-800 mb-4">Your cart is empty</h2>
            <p className="text-gray-600 mb-8">Add some delicious items to get started!</p>
            <button
              onClick={() => navigate('/')}
              className="bg-primary text-white px-8 py-3 rounded-lg font-semibold cursor-pointer hover:bg-primary-dark transition-colors"
            >
              Browse Restaurants
            </button>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pt-24 pb-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Your Cart</h1>
            <button
              onClick={clearCart}
              className="text-red-600 hover:text-red-700 font-medium flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Clear Cart
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Cart Items */}
            <div className="lg:col-span-2 space-y-4">
              <AnimatePresence>
                {cart.map((item) => {
                  // Handle both database structure (menuItem object) and old structure (flat object)
                  const menuItem = item.menuItem || item;
                  const itemId = menuItem._id || item._id;
                  const restaurantName = item.restaurantId?.restaurantDetails?.kitchenName || item.restaurantName;
                  
                  return (
                  <motion.div
                    key={itemId}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow"
                  >
                    <div className="flex gap-4">
                      {/* Item Image */}
                      <div className="w-24 h-24 shrink-0">
                        <img
                          src={menuItem.image || 'https://via.placeholder.com/150'}
                          alt={menuItem.name}
                          onError={(e) => {
                            e.target.src = fallbackImg;
                            e.target.onerror = null;
                          }}
                          className="w-full h-full object-cover rounded-lg"
                        />
                      </div>

                      {/* Item Details */}
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h3 className="text-lg font-semibold text-gray-900">{menuItem.name}</h3>
                            {restaurantName && (
                              <p className="text-sm text-gray-500">From: {restaurantName}</p>
                            )}
                          </div>
                          {menuItem.isVeg !== undefined && (
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              menuItem.isVeg ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                            }`}>
                              {menuItem.isVeg ? 'Veg' : 'Non-Veg'}
                            </span>
                          )}
                        </div>

                        {menuItem.description && (
                          <p className="text-sm text-gray-600 mb-3 line-clamp-2">{menuItem.description}</p>
                        )}

                        {/* Price and Quantity Controls */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {/* Quantity Controls */}
                            <div className="flex items-center border border-gray-300 rounded-lg">
                              <button
                                onClick={() => handleQuantityChange(itemId, -1)}
                                className="px-3 py-1 text-gray-600 hover:bg-gray-100 transition-colors rounded-l-lg"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                </svg>
                              </button>
                              <span className="px-4 py-1 font-medium text-gray-900">{item.quantity}</span>
                              <button
                                onClick={() => handleQuantityChange(itemId, 1)}
                                className="px-3 py-1 text-gray-600 hover:bg-gray-100 transition-colors rounded-r-lg"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                              </button>
                            </div>

                            {/* Price */}
                            <div className="text-lg font-bold text-gray-900">
                              ₹{(menuItem.price * item.quantity).toFixed(2)}
                            </div>
                          </div>

                          {/* Remove Button */}
                          <button
                            onClick={() => removeFromCart(itemId)}
                            className="text-red-500 hover:text-red-700 p-2 hover:bg-red-50 rounded-lg transition-colors"
                            title="Remove item"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
                })}
              </AnimatePresence>
            </div>

            {/* Order Summary */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-lg shadow-md p-6 sticky top-24">
                <h2 className="text-xl font-bold text-gray-900 mb-6">Order Summary</h2>

                <div className="space-y-3 mb-6">
                  <div className="flex justify-between text-gray-600">
                    <span>Subtotal ({cart.length} items)</span>
                    <span>₹{subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>Delivery Fee</span>
                    <span className={deliveryFee === 0 ? 'text-green-600 font-medium' : ''}>
                      {deliveryFee === 0 ? 'FREE' : `₹${deliveryFee.toFixed(2)}`}
                    </span>
                  </div>
                  {subtotal < FREE_DELIVERY_THRESHOLD && (
                    <p className="text-xs text-green-600 bg-green-50 p-2 rounded">
                      Add ₹{(FREE_DELIVERY_THRESHOLD - subtotal).toFixed(2)} more for free delivery
                    </p>
                  )}
                  <div className="flex justify-between text-gray-600">
                    <span>Platform Fee</span>
                    <span>₹{PLATFORM_FEE.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>GST (5%)</span>
                    <span>₹{gst.toFixed(2)}</span>
                  </div>
                  <div className="border-t border-gray-200 pt-3 mt-3">
                    <div className="flex justify-between text-lg font-bold text-gray-900">
                      <span>Total</span>
                      <span>₹{total.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {/* Delivery Address */}
                {user && (
                  <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="text-sm font-semibold text-gray-700">Delivery Address</h3>
                      <button
                        onClick={() => setShowLocationPicker(true)}
                        className="text-xs text-primary hover:text-primary-dark"
                      >
                        Change
                      </button>
                    </div>
                    <p className="text-sm text-gray-600">
                      {deliveryAddress || 'No address added'}
                    </p>
                    {deliveryCoordinates && (
                      <div className="mt-2 pt-2 border-t border-gray-200">
                        <p className="text-xs text-gray-500">
                          📍 Coordinates: {deliveryCoordinates.latitude.toFixed(6)}, {deliveryCoordinates.longitude.toFixed(6)}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Checkout Button */}
                <button
                  onClick={handleCheckout}
                  className="w-full bg-primary text-white py-3 rounded-lg font-semibold hover:bg-primary-dark transition-colors flex items-center justify-center gap-2"
                >
                  <span>Proceed to Checkout</span>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </button>

                {/* Save to Wishlist Button */}
                <button
                  onClick={() => setShowWishlistModal(true)}
                  className="w-full mt-3 border-2 border-primary text-primary py-3 rounded-lg font-semibold hover:bg-primary/10 transition-colors flex items-center justify-center gap-2"
                >
                  <span className='flex gap-2 items-center justify-center'><img src={heart} className="size-6" alt="" /> Save to Wishlist</span>
                </button>

                {/* Continue Shopping */}
                <button
                  onClick={() => navigate('/')}
                  className="w-full mt-3 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                >
                  Continue Shopping
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Checkout Modal */}
      <AnimatePresence>
        {showCheckoutModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
            onClick={() => setShowCheckoutModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                {/* Modal Header */}
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-gray-900">Checkout</h2>
                  <button
                    onClick={() => setShowCheckoutModal(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Order Items Summary */}
                <div className="mb-6">
                  <h3 className="font-semibold text-gray-900 mb-3">Order Items</h3>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {cart.map((item) => {
                      const menuItem = item.menuItem || item;
                      const itemId = menuItem._id || item._id;
                      return (
                        <div key={itemId} className="flex justify-between text-sm">
                          <span className="text-gray-600">
                            {menuItem.name} x {item.quantity}
                          </span>
                          <span className="font-medium">₹{(menuItem.price * item.quantity).toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Delivery Address */}
                <div className="mb-6">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Delivery Address
                  </label>
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600">{deliveryAddress}</p>
                    {deliveryCoordinates && (
                      <p className="text-xs text-gray-500 mt-2 pt-2 border-t border-gray-200">
                        📍 Coordinates: {deliveryCoordinates.latitude.toFixed(6)}, {deliveryCoordinates.longitude.toFixed(6)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Delivery Instructions */}
                <div className="mb-6">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Delivery Instructions (Optional)
                  </label>
                  <textarea
                    value={deliveryInstructions}
                    onChange={(e) => setDeliveryInstructions(e.target.value)}
                    placeholder="E.g., Ring the doorbell, Leave at door, etc."
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
                    rows="3"
                  />
                </div>

                {/* Payment Method */}
                <div className="mb-6">
                  <label className="block text-sm font-semibold text-gray-700 mb-3">
                    Payment Method
                  </label>
                  <div className="space-y-3">
                    <label className="flex items-center p-4 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                      <input
                        type="radio"
                        name="payment"
                        value="cod"
                        checked={paymentMethod === 'cod'}
                        onChange={(e) => setPaymentMethod(e.target.value)}
                        className="w-4 h-4 text-primary focus:ring-primary"
                      />
                      <div className="ml-3 flex-1">
                        <div className="font-medium text-gray-900">Cash on Delivery</div>
                        <div className="text-sm text-gray-500">Pay when you receive your order</div>
                      </div>
                      <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </label>
                    <label className="flex items-center p-4 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                      <input
                        type="radio"
                        name="payment"
                        value="online"
                        checked={paymentMethod === 'online'}
                        onChange={(e) => setPaymentMethod(e.target.value)}
                        className="w-4 h-4 text-primary focus:ring-primary"
                      />
                      <div className="ml-3 flex-1">
                        <div className="font-medium text-gray-900">Online Payment</div>
                        <div className="text-sm text-gray-500">Pay using UPI, Card, or Net Banking</div>
                      </div>
                      <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                      </svg>
                    </label>
                  </div>
                </div>

                {/* Order Total */}
                <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                  <div className="flex justify-between text-lg font-bold text-gray-900">
                    <span>Total Amount</span>
                    <span>₹{total.toFixed(2)}</span>
                  </div>
                </div>

                {/* Place Order Button */}
                <button
                  onClick={handlePlaceOrder}
                  className="w-full bg-primary text-white py-3 rounded-lg font-semibold hover:bg-primary-dark transition-colors"
                >
                  Place Order
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Location Picker Modal */}
      <AnimatePresence>
        {showLocationPicker && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
            onClick={() => setShowLocationPicker(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden relative"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close Button */}
              <button
                onClick={() => setShowLocationPicker(false)}
                className="absolute top-4 right-4 z-10 bg-white rounded-full p-2 shadow-lg hover:bg-gray-100 transition-colors"
              >
                <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {/* Location Picker Header */}
              <div className="bg-primary text-white p-4">
                <h3 className="text-xl font-bold">Select Delivery Address</h3>
                <p className="text-sm opacity-90 mt-1">Choose your delivery location on the map</p>
              </div>

              {/* Location Picker Component */}
              <div className="h-[600px]">
                <LocationPicker 
                  onLocationSelect={handleLocationSelect}
                  initialPosition={deliveryCoordinates ? [deliveryCoordinates.latitude, deliveryCoordinates.longitude] : null}
                  initialSearch={deliveryAddress || ''}
                  allowCoordinatesOnly={true}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Save to Wishlist Modal */}
      <AnimatePresence>
        {showWishlistModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
            onClick={() => setShowWishlistModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-lg shadow-xl w-full max-w-md p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <img src={heart} className="size-8" alt="" /> Save to Wishlist
              </h3>
              
              <p className="text-gray-600 mb-4">
                Give your wishlist a name to save it for later
              </p>

              <input
                type="text"
                value={wishlistName}
                onChange={(e) => setWishlistName(e.target.value)}
                placeholder="e.g., Weekend Favorites, Quick Lunch"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent mb-4"
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handleSaveToWishlist();
                  }
                }}
              />

              <div className="flex gap-2">
                <button
                  onClick={handleSaveToWishlist}
                  className="flex-1 bg-primary text-white py-3 rounded-lg font-semibold hover:bg-primary-dark transition-colors"
                >
                  Save Wishlist
                </button>
                <button
                  onClick={() => {
                    setShowWishlistModal(false);
                    setWishlistName('');
                  }}
                  className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Payment In Progress Overlay — shown while payment tab is open */}
      <AnimatePresence>
        {paymentTabOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
          >
            <motion.div
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.85, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl p-10 max-w-sm w-full text-center"
            >
              {/* Spinner */}
              <div className="relative w-24 h-24 mx-auto mb-6">
                <div className="absolute inset-0 rounded-full border-4 border-orange-100" />
                <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-orange-500 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center text-4xl">💳</div>
              </div>

              <h2 className="text-2xl font-bold text-gray-900 mb-2">Payment In Progress</h2>
              <p className="text-gray-500 text-sm mb-6">
                Complete your payment in the tab that just opened.<br />
                This page will update automatically once done.
              </p>

              <div className="flex items-center gap-2 justify-center text-orange-500 text-xs font-medium animate-pulse mb-6">
                <span className="w-2 h-2 rounded-full bg-orange-500 inline-block" />
                Waiting for payment confirmation…
              </div>

              <button
                onClick={() => {
                  if (paymentTabRef.current && !paymentTabRef.current.closed) {
                    paymentTabRef.current.focus();
                  }
                }}
                className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold transition-colors mb-3"
              >
                Return to Payment Tab
              </button>

              <button
                onClick={() => {
                  setPaymentTabOpen(false);
                  paymentTabRef.current = null;
                }}
                className="w-full py-2 rounded-xl border border-gray-200 text-gray-500 text-sm hover:bg-gray-50 transition-colors"
              >
                Cancel / Go back to cart
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ViewCart;
