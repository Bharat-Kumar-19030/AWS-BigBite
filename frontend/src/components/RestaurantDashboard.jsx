import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import axios from 'axios';
import api from '../services/api';
import fallbackImg from '../assets/fallback.jpg';

const RestaurantDashboard = () => {
  const { user, checkAuth, setShowKitchenDetailsModal, loading: authLoading } = useAuth();
  const { socket, authenticateRestaurant, acceptOrder, rejectOrder } = useSocket();
  const navigate = useNavigate();
  const SERVER_URL = import.meta.env.VITE_SERVER_URL ;
  const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
  const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;

  const [menuItems, setMenuItems] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [showUnavailable, setShowUnavailable] = useState(true);
  const [isKitchenOpen, setIsKitchenOpen] = useState(true);
  const [incomingOrders, setIncomingOrders] = useState([]);
  const [showOrderNotification, setShowOrderNotification] = useState(false);
  const [activeOrderTab, setActiveOrderTab] = useState('pending'); // pending, accepted, assigned, delivered, rejected
  const [allOrders, setAllOrders] = useState([]);
  const [activeTab, setActiveTab] = useState(0); // menu=1, orders=0

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    category: 'Main Course',
    cuisine: 'Indian',
    subCategory: '',
    image: '',
    isVeg: true,
    isAvailable: true,
  });

  const cuisines = ['Indian', 'Chinese', 'Italian', 'Mexican', 'Thai', 'Japanese', 'French', 'Mediterranean', 'American', 'Korean', 'Middle Eastern', 'Continental'];
  const categories = ['Starter', 'Main Course', 'Dessert', 'Beverage', 'Snacks'];
  const subCategories = ['Pizza', 'Burger', 'Pasta', 'Noodles', 'Rice', 'Sandwich', 'Salad', 'Soup', 'Curry', 'Biryani', 'Kebab', 'Meal', 'Cake', 'Dessert', 'Juice', 'Coffee', 'Tea'];

  useEffect(() => {
    // Wait for auth to finish loading
    if (authLoading) return;
    
    if (!user || user.role !== 'restaurant') {
      navigate('/');
      toast.error('Access denied. Restaurant account required.');
      return;
    }
    
    fetchMenuItems();
    fetchAllOrders();
    setIsKitchenOpen(user?.restaurantDetails?.isKitchenOpen ?? true);
    
    // Authenticate restaurant for socket
    if (user?.id && socket) {
      authenticateRestaurant(user.id);
    }
    
    // Debug user object
    console.log('👤 RestaurantDashboard - Current User:', {
      name: user?.name,
      role: user?.role,
      kitchenName: user?.restaurantDetails?.kitchenName,
      street: user?.restaurantDetails?.address?.street,
      cuisine: user?.restaurantDetails?.cuisine,
      fullRestaurantDetails: user?.restaurantDetails,
    });
  }, [user, socket]);

  const fetchAllOrders = useCallback(async () => {
    if (!user?.id) {
      console.log('⚠️ Cannot fetch orders - user ID not available');
      return;
    }
    try {
      console.log('🔄 Fetching orders for restaurant:', user.id);
      const response = await axios.get(
        `${SERVER_URL}/api/orders/restaurant/${user.id}`,
        { withCredentials: true }
      );
      console.log('📥 Orders API Response:', response.data);
      if (response.data.success) {
        console.log('📊 Fetched orders:', response.data.orders.length);
        console.log('📋 Order details:', response.data.orders.map(o => ({
          id: o._id,
          status: o.status,
          customer: o.customer?.name,
          total: o.totalAmount
        })));
        setAllOrders(response.data.orders);
      } else {
        console.error('❌ Orders API returned success: false');
      }
    } catch (error) {
      console.error('❌ Error fetching orders:', error.response?.data || error.message);
    }
  }, [user?.id]);

  // Socket listener for new orders
  useEffect(() => {
    if (!socket) {
      console.log('⚠️ Socket not available in RestaurantDashboard');
      return;
    }

    console.log('✅ Setting up socket listeners for restaurant');

    socket.on('authenticated', (data) => {
      console.log('✅ Restaurant authenticated:', data);
    });

    socket.on('new_order_received', (orderData) => {
      console.log('🔔 Restaurant received new order:', orderData);
      
      // Add to incoming orders list
      setIncomingOrders((prev) => [orderData, ...prev]);
      
      // Refresh all orders to include the new one
      fetchAllOrders();
      
      // Show notification
      setShowOrderNotification(true);
      toast.success(`New order #${orderData.orderId.toUpperCase().slice(-6)} received!`, {
        duration: 5000,
        icon: '📦',
      });

      // Auto-hide notification after 5 seconds
      setTimeout(() => setShowOrderNotification(false), 5000);
    });

    socket.on('order_status_changed', (data) => {
      console.log('📊 Order status updated:', data);
      
      // Refresh orders when status changes
      fetchAllOrders();
    });

    return () => {
      socket.off('authenticated');
      socket.off('new_order_received');
      socket.off('order_status_changed');
    };
  }, [socket, fetchAllOrders]);

  const fetchIncomingOrders = async () => {
    try {
      const response = await axios.get(
        `${SERVER_URL}/api/orders/restaurant/${user?.id}`,
        { withCredentials: true }
      );
      if (response.data.success) {
        setIncomingOrders(response.data.orders);
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    }
  };

  const hasKitchenDetails = () => {
    const hasName = user?.restaurantDetails?.kitchenName && user.restaurantDetails.kitchenName.trim() !== '';
    const hasAddress = user?.restaurantDetails?.address?.street && user.restaurantDetails.address.street.trim() !== '';
    const hasCuisine = Array.isArray(user?.restaurantDetails?.cuisine) && user.restaurantDetails.cuisine.length > 0;
    
    // console.log('🔍 Kitchen Details Check:', {
    //   hasName,
    //   hasAddress,
    //   hasCuisine,
    //   kitchenName: user?.restaurantDetails?.kitchenName,
    //   street: user?.restaurantDetails?.address?.street,
    //   cuisine: user?.restaurantDetails?.cuisine,
    // });
    
    return hasName && hasAddress && hasCuisine;
  };

  const handleAddMenuItem = () => {
    if (!hasKitchenDetails()) {
      toast.error('Please complete your kitchen details before adding menu items');
      setShowKitchenDetailsModal(true);
      return;
    }
    setShowAddModal(true);
  };

  const fetchMenuItems = async () => {
    try {
      const response = await api.getMenuItems();
      if (response.success) {
        setMenuItems(response.data || []);
      }
    } catch (error) {
      console.error('Error fetching menu items:', error);
      // Handle authentication errors
      if (error.message === 'Authentication required. Please log in again.' || 
          error.response?.status === 401) {
        console.log('Token is invalid or expired, redirecting to login');
        // Optionally redirect to login
        toast.error('Session expired. Please log in again.');
      }
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image size should be less than 5MB');
      return;
    }

    setUploading(true);
    const formDataUpload = new FormData();
    formDataUpload.append('file', file);
    formDataUpload.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

    try {
      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
        {
          method: 'POST',
          body: formDataUpload,
        }
      );

      const data = await response.json();
      if (data.secure_url) {
        setFormData({ ...formData, image: data.secure_url });
        toast.success('Image uploaded successfully!');
      }
    } catch (error) {
      console.error('Image upload error:', error);
      toast.error('Failed to upload image');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      if (editingItem) {
        await api.updateMenuItem(editingItem._id, formData);
        toast.success('Menu item updated!');
      } else {
        await api.addMenuItem(formData);
        toast.success('Menu item added!');
      }
      
      fetchMenuItems();
      resetForm();
    } catch (error) {
      console.error('Error saving menu item:', error);
      toast.error(error.message || 'Failed to save menu item');
      // Handle authentication errors
      if (error.message === 'Authentication required. Please log in again.' || 
          error.response?.status === 401) {
        toast.error('Session expired. Please log in again.');
      }
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this item?')) return;

    try {
      await api.deleteMenuItem(id);
      toast.success('Menu item deleted!');
      fetchMenuItems();
    } catch (error) {
      console.error('Error deleting menu item:', error);
      toast.error('Failed to delete menu item');
      // Handle authentication errors
      if (error.message === 'Authentication required. Please log in again.' || 
          error.response?.status === 401) {
        toast.error('Session expired. Please log in again.');
      }
    }
  };

  const toggleAvailability = async (id, currentStatus) => {
    try {
      await api.updateMenuItem(id, { isAvailable: !currentStatus });
      toast.success(currentStatus ? 'Item marked as unavailable' : 'Item marked as available');
      fetchMenuItems();
    } catch (error) {
      console.error('Error updating availability:', error);
      toast.error('Failed to update availability');
      // Handle authentication errors
      if (error.message === 'Authentication required. Please log in again.' || 
          error.response?.status === 401) {
        toast.error('Session expired. Please log in again.');
      }
    }
  };

  const toggleKitchen = async () => {
    try {
      const response = await api.toggleKitchenStatus();
      setIsKitchenOpen(response.isKitchenOpen);
      toast.success(response.message);
      // Refresh user data to sync with backend
      await checkAuth();
    } catch (error) {
      console.error('Toggle kitchen error:', error);
      toast.error(error.message || 'Failed to toggle kitchen status');
      // Handle authentication errors
      if (error.message === 'Authentication required. Please log in again.' || 
          error.response?.status === 401) {
        toast.error('Session expired. Please log in again.');
      }
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      price: '',
      category: 'Main Course',
      cuisine: 'Indian',
      subCategory: '',
      image: '',
      isVeg: true,
      isAvailable: true,
    });
    setEditingItem(null);
    setShowAddModal(false);
  };

  const handleAcceptOrder = (order) => {
    acceptOrder(order.orderId, user.id);
    toast.success(`Order #${order.orderId.slice(-6)} accepted!`);
    // Remove from incoming orders
    setIncomingOrders((prev) => prev.filter((o) => o.orderId !== order.orderId));
    // Refresh all orders
    fetchAllOrders();
  };

  const handleRejectOrder = (order) => {
    const reason = prompt('Enter rejection reason:');
    if (reason) {
      rejectOrder(order.orderId, user.id, reason);
      toast.error(`Order #${order.orderId.slice(-6)} rejected`);
      // Remove from incoming orders
      setIncomingOrders((prev) => prev.filter((o) => o.orderId !== order.orderId));
      // Refresh all orders
      fetchAllOrders();
    }
  };

  const getFilteredOrders = () => {
    switch (activeOrderTab) {
      case 'pending':
        // Only show truly pending orders that haven't been accepted yet
        return allOrders.filter((o) => o.status === 'pending');
      case 'accepted':
        // Show orders accepted by restaurant but not yet picked up by rider
        return allOrders.filter(o => o.status === 'awaiting_rider'||o.status==="accepted");
      case 'assigned':
        return allOrders.filter(o => ['rider_assigned', 'preparing', 'ready', 'picked_up', 'on_the_way'].includes(o.status));
      case 'delivered':
        return allOrders.filter(o => o.status === 'delivered');
      case 'rejected':
        return allOrders.filter(o => ['rejected', 'auto_rejected', 'cancelled'].includes(o.status));
      default:
        return [];
    }
  };

  const getStatusBadgeColor = (status) => {
    const colors = {
      pending: 'bg-yellow-100 text-yellow-800',
      accepted: 'bg-blue-100 text-blue-800',
      rider_assigned: 'bg-purple-100 text-purple-800',
      preparing: 'bg-indigo-100 text-indigo-800',
      ready: 'bg-cyan-100 text-cyan-800',
      picked_up: 'bg-teal-100 text-teal-800',
      on_the_way: 'bg-green-100 text-green-800',
      delivered: 'bg-green-200 text-green-900',
      rejected: 'bg-red-100 text-red-800',
      auto_rejected: 'bg-gray-100 text-gray-800',
      cancelled: 'bg-red-200 text-red-900',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const startEdit = (item) => {
    setFormData({
      name: item.name,
      description: item.description,
      price: item.price,
      category: item.category,
      cuisine: item.cuisine,
      subCategory: item.subCategory,
      image: item.image,
      isVeg: item.isVeg,
      isAvailable: item.isAvailable,
    });
    setEditingItem(item);
    setShowAddModal(true);
  };

  if (user?.role !== 'restaurant') {
    return (
      <div className="min-h-screen flex items-center justify-center pt-20">
        <p className="text-gray-500">Access denied. Restaurant owners only.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pt-20 pb-12">
      <div className=" mx-auto px-4 sm:px-6 lg:px-8">
        <div className='flex w-full justify-around items-stretch rounded-t-4xl '>
          <div onClick={()=>{setActiveTab(0)}} className={`p-2 md:pt-6 rounded-tl-xl cursor-pointer w-full flex flex-1 flex-col items-center ${activeTab===0?'bg-white':'bg-gray-100'}`}>
            <h1 className="p-2 md:text-3xl font-bold text-gray-900 poppins-bold ">Order Management</h1>
            <p className="text-gray-600 mt-1 poppins-regular">Manage all your restaurant orders in one place</p>
          </div>
          <div onClick={()=>{setActiveTab(1)}} className={`p-2 md:pt-6 rounded-tr-xl cursor-pointer w-full flex flex-1 flex-col items-center ${activeTab===1?'bg-white':'bg-gray-100'}`}>
            <h1 className="p-2 md:text-3xl font-bold text-gray-900 poppins-bold">Menu Management</h1>
            <p className="text-gray-600 mt-1 poppins-regular">Add and manage your restaurant menu items</p>
          </div>
        </div>
        {/* Comprehensive Order Management Section */}
        {activeTab === 0 && <div className="mb-8 bg-white rounded-lg shadow-lg">
          
          <div className="flex justify-end w-full items-center p-4 ">
              <button
              onClick={toggleKitchen}
              className={`px-6 py-3 rounded-lg transition shadow-lg font-medium ${
                isKitchenOpen
                  ? 'bg-orange-500 text-white hover:bg-orange-600'
                  : 'bg-green-500 text-white hover:bg-green-600'
              }`}
            >
              {isKitchenOpen ? '🔒 Close Kitchen' : '🔓 Open Kitchen'}
            </button>
            </div>
          {/* Order Tabs */}
          <div className="border-t border-b border-gray-200 pt-2">
            
            <nav className="flex -mb-px justify-between w-full overflow-auto scroll scrollbar-hide">
              {[
                { key: 'pending', label: 'Pending', count: allOrders.filter(o => o.status === 'pending').length },
                { key: 'accepted', label: 'Accepted', count: allOrders.filter(o => o.status === 'awaiting_rider'||o.status==="accepted").length },
                { key: 'assigned', label: 'Assigned/Active', count: allOrders.filter(o => ['rider_assigned', 'preparing', 'ready', 'picked_up', 'on_the_way'].includes(o.status)).length },
                { key: 'delivered', label: 'Delivered', count: allOrders.filter(o => o.status === 'delivered').length },
                { key: 'rejected', label: 'Rejected/Cancelled', count: allOrders.filter(o => ['rejected', 'auto_rejected', 'cancelled'].includes(o.status)).length },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveOrderTab(tab.key)}
                  className={`w-full px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                    activeOrderTab === tab.key
                      ? 'border-primary text-primary'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {tab.label} ({tab.count})
                </button>
              ))}
            </nav>
          </div>

          {/* Orders List */}
          <div className="p-6">
            {getFilteredOrders().length === 0 ? (
              <div className="text-center py-12">
                <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No orders found</h3>
                <p className="text-gray-600">No orders in this category</p>
              </div>
            ) : (
              <div className="space-y-4">
                {getFilteredOrders().map((order) => (
                  <motion.div
                    key={order._id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="font-semibold text-lg text-gray-900">
                          Order #{order.orderNumber || order._id.slice(-8).toUpperCase()}
                        </h3>
                        <p className="text-sm text-gray-600 mt-1">
                          Customer: {order.customer?.name} | {order.customer?.phone}
                        </p>
                        {order.rider && (
                          <p className="text-sm text-blue-600 font-medium mt-1">
                            Rider: {order.rider.name} | {order.rider.phone}
                          </p>
                        )}
                        <p className="text-xs text-gray-500 mt-1">
                          {new Date(order.createdAt).toLocaleString()}
                        </p>
                        {order.status === 'auto_rejected' && (
                          <p className="text-xs text-red-600 mt-1">
                            Auto-rejected: No action taken within 10 minutes
                          </p>
                        )}
                        {order.cancellationReason && (
                          <p className="text-xs text-red-600 mt-1">
                            ❌ Reason: {order.cancellationReason}
                          </p>
                        )}
                      </div>
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusBadgeColor(order.status)}`}>
                        {order.status.replace(/_/g, ' ').toUpperCase()}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <p className="text-sm text-gray-600">Delivery Address</p>
                        <p className="text-sm font-medium text-gray-900">
                          {order.deliveryAddress?.fullAddress || 'N/A'}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600">Order Total</p>
                        <p className="text-sm font-medium text-gray-900">
                          {console.log("order:", order)}
                          ₹{order.totalAmount.toFixed(2)}
                        </p>
                      </div>
                    </div>

                    {/* Items Preview */}
                    {order.items && order.items.length > 0 && (
                      <div className="mb-4 pb-4 border-b border-gray-200">
                        <p className="text-sm text-gray-600 mb-2">Items:</p>
                        <div className="space-y-1">
                          {order.items.map((item, idx) => (
                            <p key={idx} className="text-sm text-gray-700">
                              {item.quantity}x {item.menuItem?.name || item.name || 'Unknown Item'}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Pickup PIN - Show on all order cards for easy access */}
                    {order.pickupPin && ['accepted', 'rider_assigned', 'preparing', 'ready'].includes(order.status) && (
                      <div className="mb-4 p-2 bg-green-50 border border-green-300 rounded-lg flex flex-wrap gap-4 items-center justify-between">
                        <p className="poppins-regular font-semibold text-green-600 mb-1">Pickup Pin</p>
                        <p className="poppins-regular font-bold text-green-600 text-center tracking-widest">
                          {order.pickupPin}
                        </p>
                      </div>
                    )}

                    {/* Action Buttons - Only show for pending orders */}
                    {activeOrderTab === 'pending' && order.status === 'pending' && (
                      <div className="flex gap-3">
                        <button
                          onClick={() => handleAcceptOrder({ orderId: order._id })}
                          className="flex-1 bg-green-500 text-white py-2 px-4 rounded-lg font-medium hover:bg-green-600 transition"
                        >
                          ✓ Accept
                        </button>
                        <button
                          onClick={() => handleRejectOrder({ orderId: order._id })}
                          className="flex-1 bg-red-500 text-white py-2 px-4 rounded-lg font-medium hover:bg-red-600 transition"
                        >
                          ✗ Reject
                        </button>
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>}

        {/* Header */}
        {activeTab === 1 && <div>
        {/* Filter */}
        <div className="mb-6 flex items-center justify-between bg-white rounded-b-lg p-4">
          <div className="flex flex-col md:flex-row items-center gap-2">
            <span className="text-gray-700 text-sm md:text-medium ">Total Items: {menuItems.length}</span>
            <span className="text-gray-400 hidden md:block">|</span>
            <span className="text-green-600 text-sm md:text-medium ">Available: {menuItems.filter(item => item.isAvailable).length}</span>
            <span className="text-gray-400 hidden md:block">|</span>
            <span className="text-red-600 text-sm md:text-medium ">Unavailable: {menuItems.filter(item => !item.isAvailable).length}</span>
          </div>
          <div className='flex flex-col md:flex-row justify-between gap-4'>
          <button
            onClick={() => setShowUnavailable(!showUnavailable)}
            className={`px-2 py-1 md:px-6 md:py-3 rounded-lg transition ${
              showUnavailable
                ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                : 'bg-primary text-white hover:bg-red-600'
            }`}
          >
            {showUnavailable ? 'Hide Unavailable' : 'Show Unavailable'}
          </button>
          <button
              onClick={handleAddMenuItem}
              className="px-2 py-1 md:px-6 md:py-3 bg-primary text-white rounded-lg hover:bg-red-600 transition shadow-lg"
            >
              + Add Menu Item
            </button>
            </div>
        </div>

        {/* Menu Items Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 bg-slate-100 p-4 place-items-center shadow-xl rounded-lg">
          {menuItems.filter(item => showUnavailable || item.isAvailable).map((item) => (
            <motion.div
              key={item._id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className={`bg-white rounded-lg shadow-md w-80 overflow-hidden ${
                !item.isAvailable ? 'opacity-50 ' : ''
              }`}
            >
              <div className="relative h-48">
                {item.image ? (
                  <img
                    src={item.image}
                    alt={item.name}
                    onError={(e) => {
                      e.target.src = fallbackImg;
                      e.target.onerror = null;
                    }}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                    <span className="text-gray-400">No Image</span>
                  </div>
                )}
                <div className="absolute top-2 right-2 flex gap-2">
                  {item.isVeg ? (
                    <span className="bg-green-500 text-white px-2 py-1 rounded text-xs">Veg</span>
                  ) : (
                    <span className="bg-red-500 text-white px-2 py-1 rounded text-xs">Non-Veg</span>
                  )}
                  {!item.isAvailable && (
                    <span className="bg-gray-500 text-white px-2 py-1 rounded text-xs">Unavailable</span>
                  )}
                </div>
              </div>

              <div className="p-4">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-lg font-semibold text-gray-900">{item.name}</h3>
                  <span className="text-primary font-bold">₹{item.price}</span>
                </div>
                <p className="text-gray-600 text-sm mb-2 line-clamp-2">{item.description}</p>
                <div className="flex gap-2 mb-4 flex-wrap">
                  <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs">{item.category}</span>
                  <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs">{item.cuisine}</span>
                  {item.subCategory && (
                    <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded text-xs">{item.subCategory}</span>
                  )}
                </div>

                <div className="space-y-2">
                   <button
                      onClick={() => startEdit(item)}
                      className="flex-1 px-3 py-2 font-medium w-full bg-gray-300 text-gray-900 rounded hover:bg-gray-400 transition text-sm"
                    >
                      Edit
                    </button>
                  
                  <div className="flex gap-2">
                    <button
                    onClick={() => toggleAvailability(item._id, item.isAvailable)}
                    className={`w-full px-3 py-2 rounded transition text-sm font-medium ${
                      item.isAvailable
                        ? 'bg-orange-500 text-white hover:bg-orange-600'
                        : 'bg-green-500 text-white hover:bg-green-600'
                    }`}
                  >
                    {item.isAvailable ? 'Mark Unavailable' : 'Mark Available'}
                  </button>
                    <button
                      onClick={() => handleDelete(item._id)}
                      className=" w-full px-3 py-2 bg-red-500 text-white rounded hover:bg-red-600 font-medium  transition text-sm"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
        </div>}

        {menuItems.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg">No menu items yet. Add your first item!</p>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">
                {editingItem ? 'Edit Menu Item' : 'Add Menu Item'}
              </h2>
              <button
                onClick={resetForm}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Item Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="Butter Chicken"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="Delicious creamy palak paneer... 300gm"
                  rows="3"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Price (₹)</label>
                  <input
                    type="number"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                    placeholder="299"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  Category <span className="text-red-500">*</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setFormData({ ...formData, category: cat })}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                        formData.category === cat
                          ? 'bg-primary text-white shadow-md scale-105'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {formData.category === cat && '✓ '}
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  Sub-Category (Optional)
                </label>
                <div className="flex flex-wrap gap-2">
                  {subCategories.map((subCat) => (
                    <button
                      key={subCat}
                      type="button"
                      onClick={() => setFormData({ ...formData, subCategory: subCat })}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                        formData.subCategory === subCat
                          ? 'bg-purple-500 text-white shadow-md scale-105'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {formData.subCategory === subCat && '✓ '}
                      {subCat}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  Cuisine <span className="text-red-500">*</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {cuisines.map((cuisine) => (
                    <button
                      key={cuisine}
                      type="button"
                      onClick={() => setFormData({ ...formData, cuisine: cuisine })}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                        formData.cuisine === cuisine
                          ? 'bg-blue-500 text-white shadow-md scale-105'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {formData.cuisine === cuisine && '✓ '}
                      {cuisine}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Item Image</label>
                <input
                  type="file"
                  onChange={handleImageUpload}
                  accept="image/*"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg"
                />
                {formData.image && (
                  <img 
                    src={formData.image} 
                    alt="Preview" 
                    onError={(e) => {
                      e.target.src = fallbackImg;
                      e.target.onerror = null;
                    }}
                    className="mt-2 h-32 w-32 object-cover rounded" 
                  />
                )}
                {uploading && <p className="text-sm text-gray-500 mt-2">Uploading...</p>}
              </div>

              <div className="flex items-center gap-6">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.isVeg}
                    onChange={(e) => setFormData({ ...formData, isVeg: e.target.checked })}
                    className="mr-2"
                  />
                  <span className="text-sm font-medium text-gray-700">Vegetarian</span>
                </label>

                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.isAvailable}
                    onChange={(e) => setFormData({ ...formData, isAvailable: e.target.checked })}
                    className="mr-2"
                  />
                  <span className="text-sm font-medium text-gray-700">Available</span>
                </label>
              </div>

              <div className="flex gap-4 pt-4">
                <button
                  type="button"
                  onClick={resetForm}
                  className="flex-1 px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="flex-1 px-6 py-3 bg-primary text-white rounded-lg hover:bg-red-600 transition disabled:opacity-50"
                >
                  {editingItem ? 'Update Item' : 'Add Item'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default RestaurantDashboard;
