import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import axios from 'axios';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useApp }  from '../context/AppContext';
import { useNavigate } from 'react-router-dom';
const API_URL= import.meta.env.VITE_API_URL;
const Chatbot = () => {
  const { user, isAuthenticated, logout } = useAuth();
  const { clearCart, refreshCart } = useApp();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'Hi! I\'m your BigBite assistant. How can I help you today?',
      timestamp: new Date()
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [usedVoiceInput, setUsedVoiceInput] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechTimeout, setSpeechTimeout] = useState(null);
  const [autoSendCountdown, setAutoSendCountdown] = useState(null); // 3,2,1 or null
  const voiceAutoSendTimerRef = useRef(null);  // holds the setTimeout id
  const voiceTranscriptRef = useRef('');        // latest captured transcript
  const sendMessageRef = useRef(null);          // always-current sendMessage ref (avoids stale closure)

  // Order placement state
  const [orderPlacementState, setOrderPlacementState] = useState(null);
  const [selectedWishlist, setSelectedWishlist] = useState(null);
  const [userWishlists, setUserWishlists] = useState([]);

  // Agent payment tab state
  const [awaitingPaymentResult, setAwaitingPaymentResult] = useState(false);
  const agentPaymentTabRef = useRef(null);

  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const synthRef = useRef(window.speechSynthesis);

  // Fetch user wishlists when chat opens
  useEffect(() => {
    if (isOpen && isAuthenticated) {
      fetchWishlists();
    }
  }, [isOpen, isAuthenticated]);

  const fetchWishlists = async () => {
    try {
      console.log('Chatbot: Fetching wishlists, isAuthenticated:', isAuthenticated);
      console.log('Chatbot: User object:', user);

      // Check if we have a valid token
      const token = localStorage.getItem('bigbite_token');
      console.log('Chatbot: Token exists:', !!token);

      if (!token) {
        console.log('Chatbot: No token found, skipping wishlist fetch');
        return;
      }

      const response = await api.getWishlists();
      console.log('Chatbot: Wishlists response:', response);
      if (response.success) {
        setUserWishlists(response.wishlists);
        console.log('Chatbot: Successfully loaded', response.wishlists.length, 'wishlists');
      } else {
        console.log('Chatbot: Wishlists response not successful:', response);
      }
    } catch (error) {
      console.error('Error fetching wishlists:', error);
      console.error('Error details:', error.response?.data || error.message);

      // Handle authentication errors
      if (error.message === 'Authentication required. Please log in again.' ||
        error.response?.status === 401) {
        console.log('Chatbot: Token is invalid or expired, clearing token');
        localStorage.removeItem('bigbite_token');
        setUserWishlists([]);
        // Optionally show login prompt or redirect
      } else {
        setUserWishlists([]);
      }
    }
  };

  // Initialize speech recognition
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onstart = () => {
        setIsListening(true);
        toast.success('Listening... Speak now', { id: 'voice-recognition' });
      };

      recognitionRef.current.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map(r => r[0].transcript)
          .join(' ')
          .trim();
        setInputText(transcript);
        voiceTranscriptRef.current = transcript;
        setUsedVoiceInput(true);
        toast.success('Voice captured!', { id: 'voice-recognition' });
      };

      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
        if (event.error === 'no-speech') {
          toast.error('No speech detected. Please try again.', { id: 'voice-recognition' });
        } else if (event.error === 'not-allowed') {
          toast.error('Microphone access denied. Please enable it in settings.', { id: 'voice-recognition' });
        } else {
          toast.error(`Error: ${event.error}`, { id: 'voice-recognition' });
        }
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);

        // Only start auto-send countdown if we actually captured something
        if (!voiceTranscriptRef.current.trim()) return;

        // Cancel any previous countdown
        if (voiceAutoSendTimerRef.current) clearTimeout(voiceAutoSendTimerRef.current);

        // 3-second countdown then auto-send
        let remaining = 3;
        setAutoSendCountdown(remaining);

        const tick = () => {
          remaining -= 1;
          if (remaining > 0) {
            setAutoSendCountdown(remaining);
            voiceAutoSendTimerRef.current = setTimeout(tick, 1000);
          } else {
            setAutoSendCountdown(null);
            voiceAutoSendTimerRef.current = null;
            // Trigger send if we still have the transcript in the input
            if (voiceTranscriptRef.current.trim()) {
              sendMessageRef.current?.();
            }
          }
        };
        voiceAutoSendTimerRef.current = setTimeout(tick, 1000);
      };
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (synthRef.current) {
        synthRef.current.cancel();
        setIsSpeaking(false);
      }
      // Clear any pending speech timeout
      if (speechTimeout) {
        clearTimeout(speechTimeout);
        setSpeechTimeout(null);
      }
    };
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Text to speech function
  const speakText = (text) => {
    if (!synthRef.current) return;

    // Clear any existing timeout
    if (speechTimeout) {
      clearTimeout(speechTimeout);
    }

    // Cancel any ongoing speech
    synthRef.current.cancel();
    setIsSpeaking(false);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    // Set up event handlers
    utterance.onstart = () => {
      console.log('Speech started');
      setIsSpeaking(true);
    };

    utterance.onend = () => {
      console.log('Speech ended naturally');
      setIsSpeaking(false);
      if (speechTimeout) {
        clearTimeout(speechTimeout);
        setSpeechTimeout(null);
      }
    };

    utterance.onerror = (event) => {
      console.error('Speech synthesis error:', event.error);
      setIsSpeaking(false);
      if (speechTimeout) {
        clearTimeout(speechTimeout);
        setSpeechTimeout(null);
      }
    };

    // Fallback timeout in case onend doesn't fire (some browsers have issues)
    const fallbackTimeout = setTimeout(() => {
      console.log('Speech fallback timeout triggered - forcing isSpeaking to false');
      setIsSpeaking(false);
      setSpeechTimeout(null);
    }, Math.max(text.length * 50, 3000)); // Estimate based on text length, minimum 3 seconds

    setSpeechTimeout(fallbackTimeout);
    synthRef.current.speak(utterance);
  };

  // Stop speech
  const stopSpeaking = () => {
    if (synthRef.current) {
      synthRef.current.cancel();
      setIsSpeaking(false);
    }

    // Clear any pending fallback timeout
    if (speechTimeout) {
      clearTimeout(speechTimeout);
      setSpeechTimeout(null);
    }
  };

  // Start voice recognition
  const startListening = () => {
    if (recognitionRef.current && !isListening) {
      try {
        recognitionRef.current.start();
      } catch (error) {
        console.error('Error starting recognition:', error);
        toast.error('Could not start voice recognition', { id: 'voice-recognition' });
      }
    }
  };

  // Stop voice recognition
  const stopListening = () => {
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();
    }
  };

  // Fuzzy string matching to find wishlist by name
  const findWishlistByName = (name) => {
    const normalizedInput = name.toLowerCase().trim();

    // Exact match first
    let match = userWishlists.find(w => w.name.toLowerCase() === normalizedInput);
    if (match) return match;

    // Partial match
    match = userWishlists.find(w => w.name.toLowerCase().includes(normalizedInput));
    if (match) return match;

    // Reverse partial match
    match = userWishlists.find(w => normalizedInput.includes(w.name.toLowerCase()));
    if (match) return match;

    // Fuzzy matching with Levenshtein-like distance
    let bestMatch = null;
    let bestScore = 0;

    userWishlists.forEach(wishlist => {
      const wishlistName = wishlist.name.toLowerCase();
      let score = 0;

      // Character overlap
      for (let char of normalizedInput) {
        if (wishlistName.includes(char)) score++;
      }

      score = score / Math.max(normalizedInput.length, wishlistName.length);

      if (score > bestScore && score > 0.5) { // 50% match threshold
        bestScore = score;
        bestMatch = wishlist;
      }
    });

    return bestMatch;
  };

  // Use AI to detect order intent and extract wishlist name
  const detectOrderIntentWithAI = async (message) => {
    try {
      console.log('🤖 Calling /detect-order-intent API...');
      const response = await api.post('/chatbot/detect-order-intent', { message });
      console.log('📦 Order intent response:', response);
      if (response.success) {
        console.log('✅ Success - wantsToOrder:', response.wantsToOrder, ', wishlistName:', response.wishlistName);
        return response.wantsToOrder ? response.wishlistName : null;
      }
      console.log('❌ Response success is false');
      return null;
    } catch (error) {
      console.error('❌ Error detecting order intent:', error);
      return null;
    }
  };

  // Use AI to detect confirmation/cancellation intent
  const detectConfirmationIntent = async (message) => {
    try {
      console.log('🤖 Calling /detect-confirmation API...');
      const response = await api.post('/chatbot/detect-confirmation', { message });
      console.log('📦 Confirmation intent response:', response);
      if (response.success) {
        console.log('✅ Success - intent:', response.intent);
        return response.intent; // 'confirm', 'cancel', or 'unclear'
      }
      console.log('❌ Response success is false, returning unclear');
      return 'unclear';
    } catch (error) {
      console.error('❌ Error detecting confirmation intent:', error);
      // Fallback to basic keyword matching
      const lowerMsg = message.toLowerCase();
      if (lowerMsg.includes('yes') || lowerMsg.includes('sure') || lowerMsg.includes('ok') || lowerMsg.includes('confirm')) {
        console.log('🔍 Fallback: detected confirm');
        return 'confirm';
      } else if (lowerMsg.includes('no') || lowerMsg.includes('cancel') || lowerMsg.includes('stop')) {
        console.log('🔍 Fallback: detected cancel');
        return 'cancel';
      }
      console.log('🔍 Fallback: unclear');
      return 'unclear';
    }
  };

  // Check if message has order keywords (pre-filter before AI call)
  const hasOrderKeywords = (message) => {
    const lowerMsg = message.toLowerCase();
    const orderKeywords = ['order', 'place', 'get me', 'buy', 'want', 'purchase', 'deliver'];
    return orderKeywords.some(keyword => lowerMsg.includes(keyword));
  };

  // Handle order placement flow
  const handleOrderPlacement = async (userInput) => {
    console.log('\n--- handleOrderPlacement called ---');
    console.log('📥 Input:', userInput);
    console.log('📍 Current orderPlacementState:', orderPlacementState);
    
    const lowerInput = userInput.toLowerCase().trim();

    // IMPORTANT: Only handle cancel/no keywords if we're actually in an order flow
    if (orderPlacementState && (lowerInput.includes('cancel') || lowerInput === 'no' || lowerInput.includes('stop'))) {
      console.log('❌ User wants to cancel order');
      setOrderPlacementState(null);
      setSelectedWishlist(null);
      return "Order cancelled. How else can I help you?";
    }

    // Handle address change request (only during order flow)
    if (orderPlacementState && (lowerInput.includes('address') || lowerInput.includes('location'))) {
      return "To change your delivery address, please go to your Profile page and update your address there. Then come back to place your order.";
    }

    // State: Confirming items
    if (orderPlacementState === 'confirming_items') {
      console.log('📦 In confirming_items state');
      const intent = await detectConfirmationIntent(userInput);
      console.log('🤔 User intent detected:', intent);
      
      if (intent === 'confirm') {
        // Move to address confirmation
        setOrderPlacementState('confirming_address');

        if (!user?.address || !user?.address?.latitude || !user?.address?.longitude) {
          setOrderPlacementState(null);
          setSelectedWishlist(null);
          return "You don't have a delivery address set up. Please go to your Profile and add your address first, then come back to place your order.";
        }

        const addressText = user.address.street
          ? `${user.address.street}, ${user.address.city || ''}, ${user.address.state || ''} ${user.address.zipCode || ''}`
          : `Lat: ${user.address.latitude}, Long: ${user.address.longitude}`;

        return `Great! Your order will be delivered to:\n ${addressText}\n\nPayment method: Cash on Delivery (COD)\n\nDo you want to proceed with the order?`;
      } else if (intent === 'cancel') {
        setOrderPlacementState(null);
        setSelectedWishlist(null);
        return "Order cancelled. Feel free to ask me anything else!";
      } else {
        return "I didn't quite understand that. Please say 'yes' to confirm the order or 'no' to cancel.";
      }
    }

    // State: Confirming address & placing order
    if (orderPlacementState === 'confirming_address') {
      console.log('🏠 In confirming_address state');
      const intent = await detectConfirmationIntent(userInput);
      console.log('🤔 User intent detected:', intent);
      
      if (intent === 'confirm') {
        console.log('✅ User confirmed, placing order...');
        setOrderPlacementState('placing_order');

        try {
          // Log the wishlist structure
          console.log('🔍 Selected wishlist:', selectedWishlist);
          console.log('🔍 Restaurant from wishlist:', selectedWishlist.restaurant);
          console.log('🔍 User data:', user);
          console.log('🔍 User ID check - _id:', user._id, 'id:', user.id);

          // Prepare order data
          const restaurant = selectedWishlist.restaurant;

          // Extract restaurant ID - handle both populated and unpopulated
          let restaurantId;
          if (typeof restaurant === 'string') {
            restaurantId = restaurant;
          } else if (restaurant && restaurant._id) {
            restaurantId = restaurant._id;
          } else {
            throw new Error('Restaurant information is missing from wishlist');
          }

          console.log('🏪 Extracted restaurant ID:', restaurantId);

          // Extract customer ID - handle both _id and id
          const customerId = user._id || user.id;
          if (!customerId) {
            throw new Error('Customer ID is missing');
          }
          console.log('👤 Customer ID:', customerId);

          // Ensure all item fields are present
          const items = selectedWishlist.items.map(item => ({
            menuItem: item.menuItem._id,
            name: item.menuItem.name,
            price: item.menuItem.price,
            quantity: item.quantity
          }));

          console.log('📋 Formatted items:', items);

          // Get restaurant coordinates
          let restaurantLat, restaurantLon;
          if (restaurant.restaurantDetails?.address) {
            restaurantLat = restaurant.restaurantDetails.address.latitude;
            restaurantLon = restaurant.restaurantDetails.address.longitude;
            console.log(`🏪 Restaurant coordinates: Lat ${restaurantLat}, Lon ${restaurantLon}`);
          } else if (typeof restaurant === 'string') {
            // If restaurant is not populated, we can't calculate distance
            // Use default fee
            console.warn('⚠️ Restaurant not populated, using default delivery fee');
          }

          console.log(`📍 Customer coordinates: Lat ${user.address.latitude}, Lon ${user.address.longitude}`);

          // Calculate distance using Haversine formula
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

          // Calculate delivery fee based on distance
          let deliveryFee = 40; // Default fee
          let distance = 0;

          console.log('\n========== DISTANCE CALCULATION ==========');
          console.log('🏪 Restaurant Coordinates:', { lat: restaurantLat, lon: restaurantLon });
          console.log('🏠 Customer Coordinates:', { lat: user.address.latitude, lon: user.address.longitude });

          if (restaurantLat && restaurantLon && user.address.latitude && user.address.longitude) {
            distance = calculateDistance(
              restaurantLat,
              restaurantLon,
              user.address.latitude,
              user.address.longitude
            );

            console.log(`📏 CALCULATED DISTANCE: ${distance.toFixed(2)} km`);
            console.log(`   From: Restaurant (${restaurantLat}, ${restaurantLon})`);
            console.log(`   To: Customer (${user.address.latitude}, ${user.address.longitude})`);

            // Delivery fee calculation: ₹8 per km
            deliveryFee = distance * 8;
            deliveryFee = Math.round(deliveryFee); // Round to nearest rupee

            console.log(`🚚 DELIVERY FEE: ₹${deliveryFee} (${distance.toFixed(2)} km × ₹8/km)`);
          } else {
            console.warn('⚠️ Missing coordinates, using default delivery fee of ₹40');
          }
          console.log('=========================================\n');

          // Calculate pricing
          const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
          const platformFee = 5; // Flat ₹5
          const gst = (subtotal + deliveryFee + platformFee) * 0.05; // 5%
          const totalAmount = subtotal + deliveryFee + platformFee + gst;

          // Build complete address string
          const addressParts = [
            user.address.street,
            user.address.city,
            user.address.state,
            user.address.zipCode,
            user.address.country
          ].filter(Boolean);

          const fullAddress = addressParts.length > 0
            ? addressParts.join(', ')
            : `Lat: ${user.address.latitude}, Long: ${user.address.longitude}`;

          const orderData = {
            customerId: customerId,
            restaurantId: restaurantId,
            items: items,
            deliveryAddress: {
              fullAddress: fullAddress,
              latitude: Number(user.address.latitude),
              longitude: Number(user.address.longitude),
              street: user.address.street || '',
              city: user.address.city || '',
              state: user.address.state || '',
              zipCode: user.address.zipCode || '',
              country: user.address.country || ''
            },
            paymentMethod: 'cod',
            pricing: {
              subtotal: Number(subtotal.toFixed(2)),
              deliveryFee: Number(deliveryFee.toFixed(2)),
              platformFee: Number(platformFee.toFixed(2)),
              gst: Number(gst.toFixed(2)),
              totalAmount: Number(totalAmount.toFixed(2))
            }
          };

          console.log('📦 Final order data being sent:', JSON.stringify(orderData, null, 2));
          const response = await api.placeOrder(orderData);

          if (response.success) {
            setOrderPlacementState(null);
            setSelectedWishlist(null);
            toast.success('Order placed successfully! 🎉');

            // Format order ID to 8 characters
            const shortOrderId = response.order._id.slice(-8).toUpperCase();

            // Create detailed breakdown
            const breakdown = `Awesome! Your order has been placed successfully!

Order ID: #${shortOrderId}

Payment Breakdown:
━━━━━━━━━━━━━━━━━━━━
Items Subtotal:  ₹${subtotal.toFixed(2)}
Delivery Fee:     ₹${deliveryFee.toFixed(2)}
Platform Fee:     ₹${platformFee.toFixed(2)}
GST (5%):         ₹${gst.toFixed(2)}
━━━━━━━━━━━━━━━━━━━━
Total Amount:     ₹${totalAmount.toFixed(2)}

Payment: Cash on Delivery (COD)

You can track your order from the "My Orders" section. The restaurant will start preparing your food soon! `;

            return breakdown;
          } else {
            throw new Error(response.message || 'Failed to place order');
          }
        } catch (error) {
          console.error('Order placement error:', error);
          setOrderPlacementState(null);
          setSelectedWishlist(null);
          return `Sorry, there was an error placing your order: ${error.message}. Please try again or contact support.`;
        }
      } else if (intent === 'cancel') {
        setOrderPlacementState(null);
        setSelectedWishlist(null);
        return "Order cancelled. How else can I help you?";
      } else {
        return "I didn't quite understand that. Please say 'yes' to proceed with the order or 'no' to cancel.";
      }
    }

    // Initial order request - use AI to detect intent FIRST, then check wishlists
    // Only proceed if AI confirms this is actually an order request
    console.log('🤖 Checking with AI if this is an order request...');
    const wishlistName = await detectOrderIntentWithAI(userInput);
    console.log('📝 AI detected wishlist name:', wishlistName);

    if (!wishlistName) {
      console.log('❌ Not an order request according to AI');
      return null; // Not an order request, let it go to general AI chat
    }

    console.log('✅ AI confirmed this is an order request for:', wishlistName);

    // User wants to order, now check prerequisites
    if (!isAuthenticated) {
      return "Please log in first to place an order through the chatbot.";
    }

    if (userWishlists.length === 0) {
      return "You don't have any wishlists yet. Add items to your wishlist first to place orders through the chatbot!";
    }

    if (wishlistName) {
      const matchedWishlist = findWishlistByName(wishlistName);

      if (!matchedWishlist) {
        const availableWishlists = userWishlists.map(w => `"${w.name}"`).join(', ');
        return ` Cannot find a wishlist matching "${wishlistName}". \n\nYour available wishlists are: ${availableWishlists}\n\nPlease add items to your wishlist to place orders from the chatbot.`;
      }

      // Found a matching wishlist
      setSelectedWishlist(matchedWishlist);
      setOrderPlacementState('confirming_items');

      const itemsList = matchedWishlist.items.map(item =>
        `  • ${item.menuItem.name} x${item.quantity} - ₹${(item.menuItem.price * item.quantity).toFixed(2)}`
      ).join('\n');

      const totalItems = matchedWishlist.items.reduce((sum, item) => sum + item.quantity, 0);
      const totalPrice = matchedWishlist.items.reduce((sum, item) => sum + (item.menuItem.price * item.quantity), 0);

      return ` Found your "${matchedWishlist.name}" wishlist!\n\n Your order contains:\n${itemsList}\n\n Total Items: ${totalItems}\n Subtotal: ₹${totalPrice.toFixed(2)}\n\nDo you want to continue with this order?`;
    }

    return null; // Not an order request
  };

  // ─── Agent Action Protocol ─────────────────────────────────────────

  // Execute actions returned by the backend agent
  const executeActions = useCallback(async (actions) => {
    if (!Array.isArray(actions) || actions.length === 0) return;
    for (const action of actions) {
      switch (action.type) {
        case 'LOGOUT':
          try {
            await logout();        // clear AuthContext + localStorage token
          } catch (e) { console.warn('logout failed', e); }
          navigate('/login');
          break;
        case 'NAVIGATE':
          navigate(action.path);
          break;
        case 'CLEAR_CART':
          try { await clearCart(); } catch (e) { console.warn('clearCart failed', e); }
          break;
        case 'REFRESH_CART':
          try { await refreshCart(); } catch (e) { console.warn('refreshCart failed', e); }
          break;
        case 'SHOW_TOAST':
          (toast[action.toastType] || toast)(action.message);
          break;
        case 'OPEN_PAYMENT_TAB':
          openAgentPaymentTab(action.paymentUrl);
          break;
        default:
          console.warn('Unknown agent action:', action.type);
      }
    }
  }, [navigate, clearCart, refreshCart]); // eslint-disable-line react-hooks/exhaustive-deps

  // Send PAYMENT_RESULT back to agent automatically after tab closes
  const sendPaymentResultToAgent = useCallback(async (resultMessage) => {
    setIsLoading(true);
    // Add an auto-sent user bubble
    setMessages(prev => [...prev, {
      role: 'user',
      content: resultMessage.startsWith('PAYMENT_RESULT: success') ? '✅ Payment completed!' : '❌ Payment cancelled/failed',
      timestamp: new Date(),
      isSystem: true,
    }]);
    try {
      const response = await fetch(`${API_URL}/chatbot/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, userInput: resultMessage }),
      });
      const data = await response.json();
      const aiResponse = data.success && data.message ? data.message : 'Sorry, could not process payment result.';
      setMessages(prev => [...prev, { role: 'assistant', content: aiResponse, timestamp: new Date() }]);
      if (data.actions?.length) await executeActions(data.actions);
    } catch (err) {
      console.error('Error sending payment result to agent:', err);
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, there was an error processing the payment result.', timestamp: new Date() }]);
    } finally {
      setIsLoading(false);
    }
  }, [user, executeActions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Open the Razorpay payment page in a new tab on behalf of the agent
  const openAgentPaymentTab = useCallback((paymentUrl) => {
    const tab = window.open(paymentUrl, '_blank');
    agentPaymentTabRef.current = tab;
    if (!tab) {
      toast.error('Popup blocked! Please allow popups for payment.');
      return;
    }
    setAwaitingPaymentResult(true);
    // Add waiting bubble in chat
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: '💳 Payment page opened in a new tab! Please complete your payment there. I\'ll update automatically once it\'s done.',
      timestamp: new Date(),
      isPaymentWaiting: true,
    }]);
  }, []);

  // Listen for postMessage from the payment tab
  useEffect(() => {
    const handleAgentPaymentMessage = (event) => {
      // Only react if we actually opened a tab
      if (!agentPaymentTabRef.current) return;
      if (event.origin !== 'https://bharat-kumar-19030.github.io') return;
      const { type, status, ref, razorpay_order_id, razorpay_payment_id, razorpay_signature } = event.data || {};
      if (type !== 'PAYMENT_RESULT') return;

      // Tab is done
      agentPaymentTabRef.current = null;
      setAwaitingPaymentResult(false);

      // Remove the waiting bubble
      setMessages(prev => prev.filter(m => !m.isPaymentWaiting));

      // Build result string for agent
      let resultMsg;
      if (status === 'success') {
        resultMsg = `PAYMENT_RESULT: success | ref=${ref} | razorpay_order_id=${razorpay_order_id} | razorpay_payment_id=${razorpay_payment_id} | razorpay_signature=${razorpay_signature}`;
      } else {
        resultMsg = `PAYMENT_RESULT: failed | ref=${ref}`;
      }

      sendPaymentResultToAgent(resultMsg);
    };

    window.addEventListener('message', handleAgentPaymentMessage);
    return () => window.removeEventListener('message', handleAgentPaymentMessage);
  }, [sendPaymentResultToAgent]);

  // Keep sendMessageRef always pointing at the latest sendMessage
  // (so the voice auto-send timer never captures a stale closure)
  const sendMessage = async () => {
    // Cancel any pending auto-send timer the moment the user sends manually
    if (voiceAutoSendTimerRef.current) {
      clearTimeout(voiceAutoSendTimerRef.current);
      voiceAutoSendTimerRef.current = null;
    }
    setAutoSendCountdown(null);
    voiceTranscriptRef.current = '';

    try {
      if (inputText.trim() === '') return;
      
      // Otherwise, use backend API for general questions
      try {
        // console.log('🚀 Sending to backend API /chatbot/chat...',inputText);
        const userMessage = {
          role: 'user',
          content: inputText,
          timestamp: new Date()
        };
        const ureq=inputText;
        setInputText('');
        setMessages(prev => [...prev, userMessage]);
        setIsLoading(true);
        const response = await fetch(`${API_URL}/chatbot/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            user: user,
            userInput: ureq,
          })
        });
        const data = await response.json();
        setIsLoading(false);
        console.log('📦 Backend Response:', JSON.stringify(data, null, 2));

        const aiResponse = data.success && data.message ? data.message : 'Sorry, I could not process that request.';

        const assistantMessage = {
          role: 'assistant',
          content: aiResponse,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, assistantMessage]);

        // Execute any frontend actions returned by the agent
        if (data.actions?.length) await executeActions(data.actions);

        // Speak response if user used voice input
        if (usedVoiceInput) {
          speakText(aiResponse);
          setUsedVoiceInput(false);
        }
        console.log('✅ Message sent successfully');
        console.log('=========================================\n');
      } catch (error) {
        console.error('❌ Error in chat API call:', error);
        console.error('📊 Error details:', error.response?.data || error.message);
        console.error('📊 Full error object:', JSON.stringify(error, null, 2));
        const errorMessage = {
          role: 'assistant',
          content: 'Sorry, I encountered an error. Please try again.',
          timestamp: new Date()
        };
        setMessages(prev => [...prev, errorMessage]);
        console.log('=========================================\n');
      } finally {
        setIsLoading(false);
      }
    } catch (error) {
      console.error('❌ Error in sendMessage outer catch:', error);
      console.error('📊 Outer error details:', JSON.stringify(error, null, 2));
      setIsLoading(false);
      console.log('=========================================\n');
    }
  };
  // Keep the ref in sync so the voice timer always calls the freshest version
  sendMessageRef.current = sendMessage;

  // Handle input key press
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Clear chat
  const clearChat = () => {
    setMessages([
      {
        role: 'assistant',
        content: 'Chat cleared! How can I help you? 🍕',
        timestamp: new Date()
      }
    ]);
    stopSpeaking();
    setOrderPlacementState(null);
    setSelectedWishlist(null);
  };

  // Parse markdown formatting in messages
  const parseMarkdown = (text) => {
    if (!text) return 'No content';
    
    // Split by lines first to preserve structure
    const lines = text.split('\n');
    
    return lines.map((line, lineIndex) => {
      // Parse bold **text**
      const parts = line.split(/(\*\*.*?\*\*)/g);
      
      return (
        <span key={lineIndex}>
          {parts.map((part, partIndex) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              // Bold text
              return <strong key={partIndex}>{part.slice(2, -2)}</strong>;
            }
            return <span key={partIndex}>{part}</span>;
          })}
          {lineIndex < lines.length - 1 && <br />}
        </span>
      );
    });
  };

  return (
    <>
      {/* Floating Chat Button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setIsOpen(true)}
            className="fixed bottom-24 right-6 w-12 h-12 p-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-full shadow-2xl flex items-center justify-center z-50 hover:shadow-3xl transition-shadow"
          >
            <lord-icon
              src="https://cdn.lordicon.com/fozsorqm.json"
              trigger="hover"
              stroke="bold"
              colors="primary:#ffffff,secondary:#ffffff"
              className="size-10">
            </lord-icon>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat Window */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 100, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 100, scale: 0.8 }}
            className="fixed bottom-6 right-6 w-96 h-[80vh] bg-white rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                  <lord-icon
                    src="https://cdn.lordicon.com/fozsorqm.json"
                    trigger="hover"
                    stroke="bold"
                    colors="primary:#ffffff,secondary:#ffffff"
                    classNmae="size-10">
                  </lord-icon>
                </div>
                <div>
                  <h3 className="font-bold">BigBite Assistant</h3>
                  <p className="text-xs text-white/80">Always here to help</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={clearChat}
                  className="p-2 hover:bg-white/20 rounded-lg transition"
                  title="Clear chat"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 hover:bg-white/20 rounded-lg transition"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Messages Container */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
              {messages.map((message, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2 ${message.role === 'user'
                      ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white'
                      : 'bg-white text-gray-800 shadow-md'
                      }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{parseMarkdown(message.content)}</p>
                    <p className={`text-xs mt-1 ${message.role === 'user' ? 'text-white/70' : 'text-gray-400'}`}>
                      {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </motion.div>
              ))}

              {/* Payment-in-progress bubble (agent-initiated) */}
              {awaitingPaymentResult && (
                <div className="flex justify-start">
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 shadow-md max-w-[85%]">
                    <div className="flex items-center gap-2 text-amber-700 text-sm font-medium mb-1">
                      <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                      Waiting for payment...
                    </div>
                    <p className="text-xs text-amber-600">Complete the payment in the tab that opened. This chat will update automatically.</p>
                    <button
                      onClick={() => agentPaymentTabRef.current && agentPaymentTabRef.current.focus()}
                      className="mt-2 text-xs text-amber-700 underline hover:text-amber-900"
                    >
                      Return to payment tab →
                    </button>
                  </div>
                </div>
              )}

              {/* Loading indicator */}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-white rounded-2xl px-4 py-3 shadow-md">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Auto-send countdown badge (voice input) */}
            {autoSendCountdown !== null && (
              <div className="mx-4 mb-1 flex items-center gap-2 px-3 py-1.5 bg-orange-50 border border-orange-200 rounded-xl text-sm text-orange-700">
                <span className="text-base">🎙️</span>
                <span className="flex-1">
                  Sending in <strong>{autoSendCountdown}</strong>s… or type to cancel
                </span>
                <button
                  onClick={() => {
                    if (voiceAutoSendTimerRef.current) {
                      clearTimeout(voiceAutoSendTimerRef.current);
                      voiceAutoSendTimerRef.current = null;
                    }
                    setAutoSendCountdown(null);
                    voiceTranscriptRef.current = '';
                  }}
                  className="text-orange-500 hover:text-orange-700 font-semibold text-xs px-2 py-0.5 rounded-lg border border-orange-300 hover:border-orange-500 transition"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Input Area */}
            <div className="p-4  border-t border-gray-200  ">
              <div className="flex items-center gap-2 ">
                <div className="flex-1 relative items-center">
                  <textarea
                    value={inputText}
                    onChange={(e) => {
                      setInputText(e.target.value);
                      // If the user edits the field manually, cancel auto-send
                      if (voiceAutoSendTimerRef.current) {
                        clearTimeout(voiceAutoSendTimerRef.current);
                        voiceAutoSendTimerRef.current = null;
                        setAutoSendCountdown(null);
                        voiceTranscriptRef.current = '';
                      }
                    }}
                    onKeyPress={handleKeyPress}
                    placeholder="Type your message..."
                    rows="1"
                    className="w-full px-4 py-2 pr-12 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:outline-none focus:border-transparent resize-none"
                    style={{ maxHeight: '100px' }}
                  />

                  {/* Voice button inside input */}
                  <button
                    onClick={isListening ? stopListening : startListening}
                    className={`absolute right-2 bottom-2 p-2 rounded-lg transition ${isListening
                      ? 'bg-red-500 text-white animate-pulse'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    title={isListening ? 'Stop listening' : 'Start voice input'}
                  >
                    {isListening ? (
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 6h12v12H6z" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                    )}
                  </button>
                </div>

                {/* Send button */}
                <button
                  onClick={sendMessage}
                  disabled={!inputText.trim() || isLoading}
                  className="cursor-pointer p-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>

                {/* Speaker button (only show when AI is speaking) */}
                {isSpeaking && (
                  <button
                    onClick={stopSpeaking}
      
                    title="Stop speaking"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default Chatbot;
