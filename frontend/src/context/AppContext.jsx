import { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';

const AppContext = createContext();

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
};

export const AppProvider = ({ children }) => {
  const SERVER_URL= import.meta.env.VITE_SERVER_URL || 'http://localhost:5000';
  const { user: authUser } = useAuth();

  const [user, setUser] = useState(null);

  // Sync user from AuthContext
  useEffect(() => {
    setUser(authUser);
  }, [authUser]);
  const [cart, setCart] = useState([]);
  const [location, setLocation] = useState('Select Location');
  // Load userLocation from localStorage on mount
  const [userLocation, setUserLocation] = useState(() => {
    const saved = localStorage.getItem('userLocation');
    return saved ? JSON.parse(saved) : null;
  });
  const [maxDistance, setMaxDistance] = useState(25); // km - max 25km radius
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All'); // e.g., 'Pizza', 'Burgers', etc.
  const [restaurants, setRestaurants] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // Haversine formula to calculate distance between two coordinates
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); // Angular distance in radians math.atan2 is used to handle edge cases the atan2 means the angle whose tangent is the quotient of two specified numbers
    const distance = R * c;
    return distance; // returns distance in km
  };

  // Mock restaurant data - will be replaced with API calls later
  useEffect(() => {
    const mockRestaurants = [
      {
        id: 1,
        name: "Pizza Paradise",
        cuisine: "Italian, Pizza",
        rating: 4.5,
        deliveryTime: "30-35 min",
        distance: "2.5 km",
        image: "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=500&h=300&fit=crop",
        offer: "50% OFF up to ₹100",
        isOpen: true,
        category: "Pizza"
      },
      {
        id: 2,
        name: "Burger Hub",
        cuisine: "American, Burgers, Fast Food",
        rating: 4.2,
        deliveryTime: "25-30 min",
        distance: "1.8 km",
        image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500&h=300&fit=crop",
        offer: "40% OFF up to ₹80",
        isOpen: true,
        category: "Burgers"
      },
      {
        id: 3,
        name: "Spice Route",
        cuisine: "Indian, North Indian, Mughlai",
        rating: 4.6,
        deliveryTime: "35-40 min",
        distance: "3.2 km",
        image: "https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=500&h=300&fit=crop",
        offer: "60% OFF up to ₹120",
        isOpen: true,
        category: "Indian"
      },
      {
        id: 4,
        name: "Sushi Station",
        cuisine: "Japanese, Sushi, Asian",
        rating: 4.7,
        deliveryTime: "40-45 min",
        distance: "4.1 km",
        image: "https://images.unsplash.com/photo-1579584425555-c3ce17fd4351?w=500&h=300&fit=crop",
        offer: "Free Delivery",
        isOpen: true,
        category: "Asian"
      },
      {
        id: 5,
        name: "Taco Fiesta",
        cuisine: "Mexican, Tacos, Burritos",
        rating: 4.3,
        deliveryTime: "30-35 min",
        distance: "2.9 km",
        image: "https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=500&h=300&fit=crop",
        offer: "30% OFF up to ₹60",
        isOpen: true,
        category: "Mexican"
      },
      {
        id: 6,
        name: "Dragon Wok",
        cuisine: "Chinese, Asian, Noodles",
        rating: 4.4,
        deliveryTime: "35-40 min",
        distance: "3.5 km",
        image: "https://images.unsplash.com/photo-1526318472351-c75fcf070305?w=500&h=300&fit=crop",
        offer: "Buy 1 Get 1 Free",
        isOpen: true,
        category: "Chinese"
      },
      {
        id: 7,
        name: "Dessert Dreams",
        cuisine: "Desserts, Ice Cream, Bakery",
        rating: 4.8,
        deliveryTime: "20-25 min",
        distance: "1.5 km",
        image: "https://images.unsplash.com/photo-1488477181946-6428a0291777?w=500&h=300&fit=crop",
        offer: "25% OFF up to ₹50",
        isOpen: true,
        category: "Desserts"
      },
      {
        id: 8,
        name: "Healthy Bowl",
        cuisine: "Healthy, Salads, Smoothies",
        rating: 4.5,
        deliveryTime: "25-30 min",
        distance: "2.2 km",
        image: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500&h=300&fit=crop",
        offer: "20% OFF",
        isOpen: true,
        category: "Healthy"
      },
      {
        id: 9,
        name: "Biryani House",
        cuisine: "Indian, Biryani, Mughlai",
        rating: 4.6,
        deliveryTime: "40-45 min",
        distance: "3.8 km",
        image: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=500&h=300&fit=crop",
        offer: "₹100 OFF above ₹499",
        isOpen: true,
        category: "Indian"
      },
      {
        id: 10,
        name: "Coffee Corner",
        cuisine: "Cafe, Coffee, Snacks",
        rating: 4.4,
        deliveryTime: "15-20 min",
        distance: "1.2 km",
        image: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=500&h=300&fit=crop",
        offer: "Free Delivery on ₹199",
        isOpen: true,
        category: "Cafe"
      },
      {
        id: 11,
        name: "Pasta Palace",
        cuisine: "Italian, Pasta, Continental",
        rating: 4.3,
        deliveryTime: "30-35 min",
        distance: "2.7 km",
        image: "https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=500&h=300&fit=crop",
        offer: "40% OFF up to ₹90",
        isOpen: false,
        category: "Italian"
      },
      {
        id: 12,
        name: "BBQ Nation",
        cuisine: "BBQ, Grilled, North Indian",
        rating: 4.7,
        deliveryTime: "45-50 min",
        distance: "4.5 km",
        image: "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=500&h=300&fit=crop",
        offer: "50% OFF up to ₹150",
        isOpen: true,
        category: "BBQ"
      }
    ];
    setRestaurants(mockRestaurants);
  }, []);

  // Load cart from DB when user logs in
  useEffect(() => {
    const fetchCart = async () => {
      if (!authUser) {
        // Clear cart if no user is logged in
        setCart([]);
        return;
      }

      const token = localStorage.getItem('bigbite_token');
      if (!token) {
        // Wait for token to be available
        setTimeout(fetchCart, 100);
        return;
      }

      try {
        const headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        };
        const response = await fetch(`${SERVER_URL}/api/cart`, {
          method: 'GET',
          headers,
        });
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.cart) {
            setCart(data.cart);
            console.log("Cart loaded from database:", data.cart);
          }
        }
      } catch (error) {
        console.error("Error loading cart:", error);
      }
    };
    fetchCart();
  }, [authUser]); // Run when authUser changes

  // Refresh cart from DB (called by agent after backend cart changes)
  const refreshCart = async () => {
    const token = localStorage.getItem('bigbite_token');
    if (!token) return;
    try {
      const response = await fetch(`${SERVER_URL}/api/cart`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.cart) {
          setCart(data.cart);
          console.log('🔄 Cart refreshed by agent:', data.cart);
        }
      }
    } catch (error) {
      console.error('Error refreshing cart:', error);
    }
  };

  // Save userLocation to localStorage when it changes
  useEffect(() => {
    if (userLocation) {
      localStorage.setItem('userLocation', JSON.stringify(userLocation));
    }
  }, [userLocation]);

  // Initialize userLocation from user profile address if not already set
  useEffect(() => {
    if (authUser && authUser.address && authUser.address.latitude && authUser.address.longitude && !userLocation) {
      console.log('📍 AppContext - Setting user coordinates from profile:', { lat: authUser.address.latitude, lon: authUser.address.longitude });
      setUserLocation({
        latitude: authUser.address.latitude,
        longitude: authUser.address.longitude
      });
    }
  }, [authUser, userLocation]);

  // Add to cart
  const addToCart = async (item) => {
    try {
      const token = localStorage.getItem('bigbite_token');
      const headers = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch(`${SERVER_URL}/api/cart/add`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          menuItem: item._id,
          quantity: 1,
          restaurantId: item.restaurantId
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.message || 'Error adding to cart');
      }

      const data = await response.json();
      if (data.success) {
        setCart(data.cart);
        console.log("Item added to cart:", data.cart);
      }
    } catch (err) {
      console.error("Add to cart error:", err);
    }
  };

  // Remove from cart
  const removeFromCart = async (itemId) => {
    try {
      const token = localStorage.getItem('bigbite_token');
      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch(`${SERVER_URL}/api/cart/remove/${itemId}`, {
        method: 'DELETE',
        headers,
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.message || 'Error removing from cart');
      }

      const data = await response.json();
      if (data.success) {
        setCart(data.cart);
        console.log("Item removed from cart:", data.cart);
      }
    } catch (err) {
      console.error("Remove from cart error:", err);
    }
  };

  // Update quantity
  const updateQuantity = async (itemId, newQuantity) => {
    if (newQuantity <= 0) {
      removeFromCart(itemId);
      return;
    }

    try {
      const token = localStorage.getItem('bigbite_token');
      // Update cart locally first for immediate UI feedback
      setCart((prevCart) =>
        prevCart.map((item) =>
          item.menuItem._id === itemId
            ? { ...item, quantity: newQuantity }
            : item
        )
      );

      // Then sync with server
      const updatedCart = cart.map((item) =>
        item.menuItem._id === itemId
          ? { ...item, quantity: newQuantity }
          : item
      );

      const response = await fetch(`${SERVER_URL}/api/cart`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : undefined,
        },
        body: JSON.stringify({
          cart: updatedCart.map(item => ({
            menuItem: item.menuItem._id,
            quantity: item.quantity,
            restaurantId: item.restaurantId._id
          }))
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.message || 'Error updating cart');
      }

      const data = await response.json();
      if (data.success) {
        setCart(data.cart);
        console.log("Cart updated:", data.cart);
      }
    } catch (err) {
      console.error("Update quantity error:", err);
    }
  };

  // Clear cart
  const clearCart = async () => {
    try {
      const token = localStorage.getItem('bigbite_token');
      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch(`${SERVER_URL}/api/cart/clear`, {
        method: 'DELETE',
        headers,
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.message || 'Error clearing cart');
      }

      setCart([]);
      console.log("Cart cleared");
    } catch (err) {
      console.error("Clear cart error:", err);
    }
  };

  // Get filtered restaurants
  const getFilteredRestaurants = () => {
    let filtered = restaurants;

    // Filter by category
    if (selectedCategory && selectedCategory !== 'All') {
      filtered = filtered.filter((restaurant) =>
        restaurant.category === selectedCategory
      );
    }

    // Filter by search query
    if (searchQuery) {
      filtered = filtered.filter((restaurant) =>
        restaurant.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        restaurant.cuisine.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return filtered;
  };

  const value = {
    user,
    setUser,
    cart,
    setCart,
    addToCart,
    removeFromCart,
    updateQuantity,
    clearCart,
    refreshCart,
    location,
    setLocation,
    userLocation,
    setUserLocation,
    maxDistance,
    setMaxDistance,
    calculateDistance,
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    restaurants,
    getFilteredRestaurants,
    isLoading,
    setIsLoading
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
