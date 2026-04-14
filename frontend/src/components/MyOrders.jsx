import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import RatingModal from './RatingModal';

const MyOrders = () => {
  const { user, loading: authLoading } = useAuth();
  const { socket, joinOrderRoom } = useSocket();
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState('all'); // all, active, completed
  const [ratingModalOpen, setRatingModalOpen] = useState(false);
  const [selectedOrderForRating, setSelectedOrderForRating] = useState(null);
  // console.log("user in my orders: ",user  )
  useEffect(() => {
    // Wait for auth to finish loading
    if (authLoading) return;

    if (!user || !user.id) {
      navigate('/');
      return;
    }
    fetchOrders();
  }, [user]);

  // Socket listeners for real-time updates
  useEffect(() => {
    if (!socket) {
      console.log('⚠️ Socket not available in MyOrders');
      return;
    }

    console.log('✅ Setting up socket listeners in MyOrders');

    const handleOrderPlaced = (data) => {
      console.log('📦 Order placed event:', data);
      toast.success(data.message);
      fetchOrders();
    };

    const handleOrderAccepted = (data) => {
      console.log('✅ Order accepted event:', data);
      toast(`Rider ${data.riderName} accepted your order!`);
      updateOrderStatus(data.orderId, data.status, {
        rider: {
          name: data.riderName,
          phone: data.riderPhone,
        }
      });
    };

    const handleOrderStatusUpdate = (data) => {
      console.log('📦 Order status changed:', data);
      // Skip toast for rider_assigned status as it's handled by order_accepted
      if (data.status !== 'rider_assigned' && data.message) {
        toast(data.message);
      }
      updateOrderStatus(data.orderId, data.status);
    };

    const handleRiderLocation = (data) => {
      console.log('📍 Rider location update:', data);
      updateRiderLocation(data.orderId, data.location);
    };

    socket.on('order_placed', handleOrderPlaced);
    socket.on('order_accepted', handleOrderAccepted);
    socket.on('order_status_changed', handleOrderStatusUpdate); // Changed from 'order_status_update'
    socket.on('rider_location', handleRiderLocation);

    return () => {
      socket.off('order_placed', handleOrderPlaced);
      socket.off('order_accepted', handleOrderAccepted);
      socket.off('order_status_changed', handleOrderStatusUpdate); // Changed from 'order_status_update'
      socket.off('rider_location', handleRiderLocation);
    };
  }, [socket]);

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const response = await axios.get(
        `${import.meta.env.VITE_SERVER_URL}/api/orders/customer/${user.id}`,
        { withCredentials: true }
      );

      if (response.data.success) {
        setOrders(response.data.orders);

        // Join socket rooms for all orders to receive real-time updates
        if (socket && response.data.orders.length > 0) {
          response.data.orders.forEach(order => {
            joinOrderRoom(order._id);
            console.log(`🔔 Joined order room: ${order._id}`);
          });
        }
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
      toast.error('Failed to fetch orders');
    } finally {
      setLoading(false);
    }
  };

  const updateOrderStatus = (orderId, status, extraData = {}) => {
    setOrders((prevOrders) =>
      prevOrders.map((order) =>
        order._id === orderId
          ? { ...order, status, ...extraData }
          : order
      )
    );
  };

  const updateRiderLocation = (orderId, location) => {
    setOrders((prevOrders) =>
      prevOrders.map((order) =>
        order._id === orderId
          ? { ...order, riderLocation: location }
          : order
      )
    );
  };

  const getStatusColor = (status) => {
    const colors = {
      pending: 'bg-yellow-100 text-yellow-800',
      accepted: 'bg-blue-100 text-blue-800',
      rider_assigned: 'bg-green-100 text-green-800',
      preparing: 'bg-purple-100 text-purple-800',
      ready: 'bg-indigo-100 text-indigo-800',
      picked_up: 'bg-cyan-100 text-cyan-800',
      on_the_way: 'bg-orange-100 text-orange-800',
      delivered: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const getStatusText = (status) => {
    const texts = {
      pending: 'Waiting for Restaurant',
      accepted: 'Restaurant Accepted',
      rider_assigned: 'Rider Accepted',
      preparing: 'Being Prepared',
      ready: 'Ready for Pickup',
      picked_up: 'Picked Up',
      on_the_way: 'On the Way',
      delivered: 'Delivered',
      cancelled: 'Cancelled',
    };
    return texts[status] || status;
  };

  const filteredOrders = orders.filter((order) => {
    if (selectedFilter === 'all') return true;
    if (selectedFilter === 'active') {
      return !['delivered', 'cancelled'].includes(order.status);
    }
    if (selectedFilter === 'completed') {
      return ['delivered', 'cancelled'].includes(order.status);
    }
    return true;
  });
  console.log("filtered orders: ", filteredOrders)
  if (loading) {
    return (<>
    <div className="min-h-screen bg-gray-50 pt-24 pb-12">
      <div className="mb-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-gray-900">My Orders</h1>
          <p className="text-gray-600 mt-2">Track your orders in real-time</p>
      </div>
      <div className=" max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 animate-pulse">
        

        {/* Tabs */}
        <div className="flex mb-8  bg-gray-200 rounded-lg overflow-hidden">
          <div className="flex-1 h-12 bg-orange-300"></div>
          <div className="flex-1 h-12 bg-gray-300"></div>
          <div className="flex-1 h-12 bg-gray-300"></div>
        </div>

        {/* Orders */}
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white mb-4 rounded-lg shadow p-4 space-y-4">

            {/* Header */}
            <div className="flex justify-between items-center">
              <div>
                <div className="h-4 w-32 bg-gray-300 rounded mb-2"></div>
                <div className="h-3 w-24 bg-gray-300 rounded"></div>
              </div>
              <div className="h-5 w-20 bg-gray-300 rounded-full"></div>
            </div>

            {/* Divider */}
            <div className="h-px bg-gray-200"></div>

            {/* Items */}
            <div className="space-y-2">
              <div className="h-3 w-40 bg-gray-300 rounded"></div>
              <div className="h-3 w-20 bg-gray-300 rounded ml-auto"></div>
            </div>

            {/* Divider */}
            <div className="h-px bg-gray-200"></div>

            {/* Address */}
            <div className="space-y-2">
              <div className="h-3 w-28 bg-gray-300 rounded"></div>
              <div className="h-3 w-full bg-gray-300 rounded"></div>
            </div>

            {/* Divider */}
            <div className="h-px bg-gray-200"></div>

            {/* Rider */}
            <div className="space-y-2">
              <div className="h-3 w-28 bg-gray-300 rounded"></div>
              <div className="h-3 w-32 bg-gray-300 rounded"></div>
            </div>

            {/* Divider */}
            <div className="h-px bg-gray-200"></div>

            {/* Total */}
            <div className="flex justify-between items-center">
              <div className="h-4 w-24 bg-gray-300 rounded"></div>
              <div className="h-4 w-16 bg-gray-300 rounded"></div>
            </div>

            {/* Button */}
            <div className="h-10 w-full bg-orange-300 rounded"></div>

          </div>
        ))}

      </div>
      </div></>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pt-24 pb-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">My Orders</h1>
          <p className="text-gray-600 mt-2">Track your orders in real-time</p>
        </div>

        {/* Filter Tabs */}
        <div className="bg-white rounded-lg shadow-sm p-2 mb-6 flex gap-2">
          {['all', 'active', 'completed'].map((filter) => (
            <button
              key={filter}
              onClick={() => setSelectedFilter(filter)}
              className={`flex-1 py-2 px-4 rounded-md font-medium transition-colors ${selectedFilter === filter
                  ? 'bg-orange-500 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
                }`}
            >
              {filter.charAt(0).toUpperCase() + filter.slice(1)}
            </button>
          ))}
        </div>

        {/* Orders List */}
        {filteredOrders.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <svg
              className="w-24 h-24 mx-auto text-gray-300 mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
            <p className="text-gray-500 text-lg">No orders found</p>
            <button
              onClick={() => navigate('/')}
              className="mt-4 px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
            >
              Browse Restaurants
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <AnimatePresence>
              {filteredOrders.map((order) => (
                <motion.div
                  key={order._id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow"
                >
                  {/* Order Header */}
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {order.restaurant?.restaurantDetails?.kitchenName}
                      </h3>
                      <p className="text-sm text-gray-500">
                        Order #{order.orderNumber || order._id.slice(-8).toUpperCase()}
                      </p>
                      <p className="text-sm text-gray-500">
                        {new Date(order.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(
                        order.status
                      )}`}
                    >
                      {getStatusText(order.status)}
                    </span>
                  </div>

                  {/* Order Items */}
                  <div className="border-t border-gray-200 pt-4 mb-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Items:</h4>
                    <div className="space-y-2">
                      {order.items.map((item, index) => (
                        <div key={index} className="flex justify-between text-sm">
                          <span className="text-gray-600">
                            {item.quantity}x {item.name}
                          </span>
                          <span className="text-gray-900 font-medium">
                            ₹{(item.price * item.quantity).toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Delivery PIN - Show when rider is assigned or later */}
                  {order.deliveryPin && ['accepted', 'rider_assigned', 'preparing', 'ready', 'picked_up', 'on_the_way'].includes(order.status) && (
                    <div className="border-t border-gray-200 pt-4 mb-4">
                      <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-300 rounded-lg p-3 flex gap-4 items-center justify-between">
                        <h4 className="text-xs font-semibold text-green-900 mb-1 flex items-center gap-1">

                          Your Delivery Pin
                        </h4>
                        <p className="text-sm font-bold text-green-700 text-center tracking-widest">
                          {order.deliveryPin}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Delivery Address */}
                  <div className="border-t border-gray-200 pt-4 mb-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-1">
                      Delivery Address:
                    </h4>
                    <p className="text-sm text-gray-600">
                      {order.deliveryAddress.fullAddress}
                    </p>
                    {order.deliveryAddress.instructions && (
                      <p className="text-sm text-gray-500 italic mt-1">
                        Note: {order.deliveryAddress.instructions}
                      </p>
                    )}
                  </div>

                  {/* Rider Info (if assigned) */}
                  {order.rider && (
                    <div className="border-t border-gray-200 pt-4 mb-4">
                      <h4 className="text-sm font-medium text-gray-700 mb-1">
                        Rider Information:
                      </h4>
                      <p className="text-sm text-gray-600">
                        {order.rider.name} - {order.rider.phone}
                      </p>
                    </div>
                  )}

                  {/* Order Total */}
                  <div className="border-t border-gray-200 pt-4 flex justify-between items-center">
                    <span className="text-gray-700 font-medium">Total Amount:</span>
                    <span className="text-xl font-bold text-gray-900">
                      ₹{order.totalAmount.toFixed(2)}
                    </span>
                  </div>

                  {/* Track Order Button (for active orders) */}
                  {!['delivered', 'cancelled'].includes(order.status) && (
                    <button
                      onClick={() => navigate(`/track-order/${order._id}`)}
                      className="mt-4 w-full py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors flex items-center justify-center gap-2"
                    >
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                      </svg>
                      Track Order Live
                    </button>
                  )}

                  {/* Rate Order Button (for delivered orders) */}
                  {order.status === 'delivered' && !order.restaurantRating && !order.riderRating && (
                    <button
                      onClick={() => {
                        setSelectedOrderForRating(order);
                        setRatingModalOpen(true);
                      }}
                      className="mt-4 w-full py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors flex items-center justify-center gap-2"
                    >
                      <svg
                        className="w-5 h-5"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                      Rate Your Order
                    </button>
                  )}

                  {/* Show if already rated */}
                  {order.status === 'delivered' && (order.restaurantRating || order.riderRating) && (
                    <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-center">
                      <p className="text-sm text-green-700 font-medium">✓ Thank you for your rating!</p>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Rating Modal */}
      {selectedOrderForRating && (
        <RatingModal
          isOpen={ratingModalOpen}
          onClose={() => {
            setRatingModalOpen(false);
            setSelectedOrderForRating(null);
          }}
          order={selectedOrderForRating}
          onRatingSubmit={() => {
            fetchOrders(); // Refresh orders to show rating status
          }}
        />
      )}
    </div>
  );
};

export default MyOrders;
