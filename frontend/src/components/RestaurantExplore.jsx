import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { useNavigate } from 'react-router-dom';
import fallbackImg from '../assets/fallback.jpg';

const RestaurantCard = ({ restaurant }) => {
  const navigate = useNavigate();
  
  return (
    <div 
      onClick={() => navigate(`/restaurant/${restaurant.id}`)}
      className="bg-white rounded-2xl shadow-lg overflow-hidden hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-2 cursor-pointer group"
    >
      {/* Image Container */}
      <div className="relative h-48 overflow-hidden">
        <img
          src={restaurant.image}
          alt={restaurant.name}
          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
        />
        
        {/* Offer Badge */}
        {restaurant.offer && (
          <div className="absolute top-4 left-4 bg-[#FF3B30] text-white px-3 py-1 rounded-lg font-semibold text-sm shadow-lg">
            {restaurant.offer}
          </div>
        )}

        {/* Vegetarian Badge */}
        {restaurant.isVegetarian && (
          <div className="absolute top-4 right-4 bg-green-600 text-white px-3 py-1 rounded-lg font-semibold text-sm shadow-lg">
            Vegetarian
          </div>
        )}

        {/* Status Badge */}
        {(!restaurant.isOpen || !restaurant.isKitchenOpen) && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <span className="bg-white text-gray-900 px-4 py-2 rounded-full font-semibold">
              {!restaurant.isKitchenOpen ? 'Kitchen Closed' : 'Closed'}
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 flex-1">
            <h3 className="text-lg font-bold text-gray-900 group-hover:text-[#FF3B30] transition-colors">
              {restaurant.name}
            </h3>
            
            {/* Rating - Only show if restaurant has ratings */}
            {restaurant.rating && (
              <div className="flex items-center space-x-1 bg-green-600 text-white px-2 py-1 rounded-lg text-xs">
                <svg
                  className="w-3 h-3"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                <span className="font-semibold">{restaurant.rating}</span>
              </div>
            )}
          </div>
        </div>

        <p className="text-gray-600 text-sm mb-3 line-clamp-1">
          {Array.isArray(restaurant.cuisine) ? restaurant.cuisine.join(', ') : restaurant.cuisine}
        </p>

        <div className="flex items-center justify-between text-sm text-gray-500">
          <div className="flex items-center space-x-1">
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span>{restaurant.deliveryTime}</span>
          </div>

          <div className="flex items-center space-x-1">
            <svg
              className="w-4 h-4"
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
            </svg>
            <span>Just {restaurant.distance} away</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const FoodItemCard = ({ item, restaurant }) => {
  const navigate = useNavigate();
  
  return (
    <div
      onClick={() => navigate(`/restaurant/${restaurant.id}/item/${item._id}`)}
      className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-all duration-300 cursor-pointer group"
    >
      <div className="relative h-48">
        <img
          src={item.image}
          alt={item.name}
          onError={(e) => {
            e.target.src = fallbackImg;
            e.target.onerror = null;
          }}
          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
        />
        <div className="absolute top-2 right-2 flex gap-2">
          {item.isVeg ? (
            <span className="bg-green-500 text-white px-2 py-1 rounded text-xs font-medium">Veg</span>
          ) : (
            <span className="bg-red-500 text-white px-2 py-1 rounded text-xs font-medium">Non-Veg</span>
          )}
        </div>
        <div className="absolute bottom-0 left-0 right-0 bg-linear-to-t from-black/70 to-transparent p-3">
          <p className="text-white text-xs">From: {restaurant.name}</p>
        </div>
      </div>

      <div className="p-4">
        <div className="flex justify-between items-start mb-2">
          <h3 className="text-lg font-semibold text-gray-900 group-hover:text-primary transition-colors">
            {item.name}
          </h3>
          <span className="text-primary font-bold">₹{item.price}</span>
        </div>
        <p className="text-gray-600 text-sm mb-3 line-clamp-2">{item.description}</p>
        
        <div className="flex gap-2 flex-wrap mb-3">
          <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs">{item.category}</span>
          <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs">{item.cuisine}</span>
          {item.subCategory && (
            <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded text-xs">{item.subCategory}</span>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-gray-500 justify-between">
          <div className="flex items-center space-x-1">
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span>{restaurant.deliveryTime}</span>
          </div>
          <div className="flex items-center space-x-1">
            <svg
              className="w-4 h-4"
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
            </svg>
            <span>Just {restaurant.distance} away</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const RestaurantExplore = () => {
  const { getFilteredRestaurants, selectedCategory, setSelectedCategory, searchQuery, userLocation, maxDistance, setMaxDistance, calculateDistance } = useApp();
  const filteredRestaurants = getFilteredRestaurants();
  const SERVER_URL = import.meta.env.VITE_SERVER_URL;
  
  const [realRestaurants, setRealRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('restaurants'); // 'restaurants' or 'items'

  // Debug userLocation
  useEffect(() => {
    console.log('🔍 RestaurantExplore - userLocation changed:', userLocation);
  }, [userLocation]);

  // Fetch restaurants when component mounts or when userLocation/maxDistance changes
  useEffect(() => {
    fetchRestaurants();
  }, [userLocation, maxDistance]);

  const fetchRestaurants = async () => {
    try {
      setLoading(true);
      
      // Build query params based on userLocation
      let url = `${SERVER_URL}/api/restaurant/all`;
      if (userLocation && userLocation.latitude && userLocation.longitude) {
        const params = new URLSearchParams({
          latitude: userLocation.latitude.toString(),
          longitude: userLocation.longitude.toString(),
          maxDistance: maxDistance.toString(),
        });
        url += `?${params.toString()}`;
        console.log('🌍 RestaurantExplore - Fetching with filter:', {
          url,
          userLocation,
          maxDistance
        });
      } else {
        console.log('📍 Fetching all restaurants (no location filter)');
      }
      
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        console.log(`✅ Fetched ${data.count} restaurants`);
        setRealRestaurants(data.data || []);
      }
    } catch (error) {
      console.error('Error fetching restaurants:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filter real restaurants by category only (distance is handled by backend)
  const filteredRealRestaurants = realRestaurants.filter(restaurant => {
    // Category filter
    if (selectedCategory !== 'All') {
      if (Array.isArray(restaurant.cuisine)) {
        return restaurant.cuisine.some(c => c.toLowerCase() === selectedCategory.toLowerCase()); //some is used to match any cuisine
      } else {
        return restaurant.cuisine?.toLowerCase().includes(selectedCategory.toLowerCase());
      }
    }
    return true;
  }).map(restaurant => {
    // Calculate and add distance to each restaurant for display
    let calculatedDistance = '-- km';
    if (userLocation && restaurant.address?.latitude && restaurant.address?.longitude) {
      const distance = calculateDistance(
        userLocation.latitude,
        userLocation.longitude,
        restaurant.address.latitude,
        restaurant.address.longitude
      );
      calculatedDistance = `${distance.toFixed(1)} km`;
    }
    return {
      ...restaurant,
      calculatedDistance
    };
  });

  const categories = [
    { name: 'All', icon: '🍽️' },
    { name: 'Indian', icon: '🍛' },
    { name: 'Chinese', icon: '🥡' },
    { name: 'Italian', icon: '🍝' },
    { name: 'Mexican', icon: '🌮' },
    { name: 'Thai', icon: '🍜' },
    { name: 'Japanese', icon: '🍱' },
    { name: 'French', icon: '🥐' },
    { name: 'Mediterranean', icon: '🥙' },
    { name: 'American', icon: '🍔' },
    { name: 'Korean', icon: '🍲' },
    { name: 'Middle Eastern', icon: '🧆' },
    { name: 'Continental', icon: '🍽️' },
  ];

  return (
    <section id="restaurants-section" className="py-12 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-10">
          <h2 className="text-4xl font-bold text-gray-900 mb-3 poppins-bold">
            Explore {viewMode === 'restaurants' ? 'Restaurants' : 'Food Items'}
          </h2>
          <p className="text-gray-600 text-lg poppins-regular">
            {searchQuery
              ? `Showing results for "${searchQuery}"`
              : viewMode === 'restaurants' 
                ? 'Discover amazing restaurants near you' 
                : 'Browse delicious food items'}
          </p>
          
          {/* Toggle Button */}
          <div className="mt-6 inline-flex rounded-lg bg-white shadow-md p-1">
            <button
              onClick={() => setViewMode('restaurants')}
              className={`px-6 py-2 rounded-lg font-medium transition-all poppins-regular ${
                viewMode === 'restaurants'
                  ? 'bg-primary text-white shadow'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              Restaurants
            </button>
            <button
              onClick={() => setViewMode('items')}
              className={`px-6 py-2 rounded-lg font-medium transition-all ${
                viewMode === 'items'
                  ? 'bg-primary text-white shadow'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              Food Items
            </button>
          </div>
        </div>

        {/* Category Filter */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold text-gray-800 poppins-regular">Filter by Cuisine</h3>
          </div>
          <div className="flex items-center space-x-3 overflow-x-auto p-2 scrollbar-hide">
            {categories.map((category) => (
              <button
                key={category.name}
                onClick={() => setSelectedCategory(category.name)}
                className={`flex items-center space-x-2 px-6 py-2 rounded-full font-medium whitespace-nowrap transition-all duration-300 ${
                  selectedCategory === category.name
                    ? 'bg-[#FF3B30] text-white shadow-lg scale-105'
                    : 'bg-white text-gray-700 hover:bg-gray-100 shadow'
                }`}
              >
                {/* <span className="text-xl">{category.icon}</span> */}
                <span>{category.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Distance Filter */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-gray-800 poppins-regular">Filter by Distance</h3>
            {(!userLocation || !userLocation.latitude || !userLocation.longitude) && (
              <p className="text-xs text-amber-600">Select location from navbar to enable distance filter</p>
            )}
          </div>
          <div className="flex items-center space-x-3 overflow-x-auto pb-4 scrollbar-hide">
            {[2, 5, 10, 15, 20, 25].map((distance) => {
              const hasLocation = userLocation && userLocation.latitude && userLocation.longitude;
              return (
              <button
                key={distance}
                onClick={() => hasLocation && setMaxDistance(distance)}
                disabled={!hasLocation}
                className={`flex items-center space-x-2 px-6 py-3 rounded-full font-medium whitespace-nowrap transition-all duration-300 ${
                  maxDistance === distance && hasLocation
                    ? 'bg-[#FF3B30] text-white shadow-lg scale-105'
                    : hasLocation
                      ? 'bg-white text-gray-700 hover:bg-gray-100 shadow'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed shadow'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>Within {distance} km</span>
              </button>
              );
            })}
          </div>
        </div>

        {/* Filter Summary */}
        <div className="mb-6 flex items-center justify-between">
          <p className="text-gray-600">
            <span className="font-semibold text-gray-900">
              {viewMode === 'restaurants' 
                ? filteredRealRestaurants.length
                : (() => {
                    let count = 0;
                    filteredRealRestaurants.forEach(restaurant => {
                      count += restaurant.menuItems?.length || 0;
                    });
                    return count;
                  })()
              }
            </span>{' '}
            {viewMode === 'restaurants' ? 'restaurants' : 'food items'} found
          </p>

          {/* Sort Dropdown */}
          {/* <div className="flex items-center space-x-4">
            <span className="text-gray-600 text-sm">Sort by:</span>
            <select className="px-4 py-2 border border-gray-300 outline-none rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF3B30] bg-white">
              <option className=" poppins-regular">Relevance</option>
              <option className=" poppins-regular">Rating: High to Low</option>
              <option className=" poppins-regular">Delivery Time</option>
              <option className=" poppins-regular">Cost: Low to High</option>
              <option className=" poppins-regular">Cost: High to Low</option>
            </select>
          </div> */}
        </div>

        {/* Loading State */}
        {loading && (
          <div className="p-6">

  {/* Header */}
  <div className="flex items-center gap-3 mb-6">
    <div className="h-6 w-12 bg-green-300 rounded-full animate-pulse"></div>
    <div className="h-5 w-48 bg-gray-300 rounded animate-pulse"></div>
  </div>

  {/* Grid */}
  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">

    {[...Array(5)].map((_, i) => (
      <div key={i} className="bg-white rounded-xl shadow-md overflow-hidden animate-pulse">
        
        {/* Image */}
        <div className="h-40 w-full bg-gray-300"></div>

        {/* Content */}
        <div className="p-4 space-y-3">

          {/* Title + Rating */}
          <div className="flex justify-between items-center">
            <div className="h-4 w-32 bg-gray-300 rounded"></div>
            <div className="h-4 w-10 bg-gray-300 rounded"></div>
          </div>

          {/* Cuisine */}
          <div className="h-3 w-full bg-gray-300 rounded"></div>
          <div className="h-3 w-3/4 bg-gray-300 rounded"></div>

          {/* Footer */}
          <div className="flex justify-between mt-2">
            <div className="h-3 w-20 bg-gray-300 rounded"></div>
            <div className="h-3 w-24 bg-gray-300 rounded"></div>
          </div>

        </div>
      </div>
    ))}

  </div>
</div>
        )}

        {/* Restaurant View */}
        {!loading && viewMode === 'restaurants' && (filteredRealRestaurants.length > 0) ? (
          <>
          {/* {console.log(filteredRealRestaurants)} */}
            {/* Real Restaurants from Database */}
            {filteredRealRestaurants.length > 0 && (
              <div className="mb-8">
                <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm animate-pulse">Live</span>
                  Registered Restaurants
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {filteredRealRestaurants.map((restaurant) => {
                    // Check if all menu items are vegetarian
                    const isVegetarian = restaurant.menuItems && 
                                       restaurant.menuItems.length > 0 && 
                                       restaurant.menuItems.every(item => item.isVeg);
                    
                    // Get restaurant rating
                    const rating = restaurant.restaurantDetails?.rating?.count > 0 
                      ? restaurant.restaurantDetails.rating.average.toFixed(1)
                      : null;
                    
                    return (
                      <RestaurantCard 
                        key={restaurant.id} 
                        restaurant={{
                          ...restaurant,
                          image: restaurant.avatar || 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=500',
                          rating: rating,
                          deliveryTime: restaurant.deliveryTime || '30-40 min',
                          distance: restaurant.calculatedDistance,
                          isOpen: restaurant.isKitchenOpen,
                          isVegetarian: isVegetarian,
                          offer: restaurant.menuCount > 5 ? '20% OFF' : null,
                        }} 
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Sample Restaurants */}
            {/* {filteredRestaurants.length > 0 && (
              <div>
                <h3 className="text-xl font-bold text-gray-900 mb-4">Sample Restaurants</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {filteredRestaurants.map((restaurant) => (
                    <RestaurantCard key={restaurant.id} restaurant={restaurant} />
                  ))}
                </div>
              </div>
            )} */}
          </>
        ) : !loading && viewMode === 'restaurants' ? (
          <div className="text-center py-16">
            <div className="inline-block p-8 bg-white rounded-full shadow-lg mb-4 animate-pulse">
              <svg
                className="w-16 h-16 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-2 poppins-bold ">
              No restaurants found
            </h3>
            <p className="text-gray-600 mb-6 poppins-regular">
              Try adjusting your search or filters
            </p>
            <button
              onClick={() => {
                setSelectedCategory('All');
              }}
              className="px-6 py-3 bg-[#FF3B30] text-white rounded-full font-semibold hover:bg-[#e63329] transition-colors"
            >
              Clear Filters
            </button>
          </div>
        ) : null}

        {/* Food Items View */}
        {!loading && viewMode === 'items' && (() => {
          // Flatten all menu items from all restaurants (already filtered by distance)
          const allMenuItems = [];
          filteredRealRestaurants.forEach(restaurant => {
            if (restaurant.menuItems && restaurant.menuItems.length > 0) {
              restaurant.menuItems.forEach(item => {
                allMenuItems.push({
                  ...item,
                  restaurantData: {
                    id: restaurant.id,
                    name: restaurant.name,
                    avatar: restaurant.avatar,
                    deliveryTime: '30-40 min',
                    distance: restaurant.calculatedDistance || '2.5 km',
                    isKitchenOpen: restaurant.isKitchenOpen,
                  }
                });
              });
            }
          });

          return allMenuItems.length > 0 ? (
            <div className='mb-8  '>
              <h3 className="text-xl font-bold text-gray-900 mb-4">
                All Food Items
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {allMenuItems.map((item) => (
                  <FoodItemCard 
                    key={`${item.restaurantData.id}-${item._id}`}
                    item={item} 
                    restaurant={item.restaurantData}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-16">
              <div className="inline-block p-8 bg-white rounded-full shadow-lg mb-4">
                <svg
                  className="w-16 h-16 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">
                No food items found
              </h3>
              <p className="text-gray-600 mb-6">
                Try adjusting your search or filters
              </p>
              <button
                onClick={() => {
                  setSelectedCategory('All');
                }}
                className="px-6 py-3 bg-[#FF3B30] text-white rounded-full font-semibold hover:bg-[#e63329] transition-colors"
              >
                Clear Filters
              </button>
            </div>
          );
        })()}
      </div>
      <div className="border-b h-1 border-gray-400 mx-10"></div>

      {/* Load More Button */}
      {/* {filteredRestaurants.length > 0 && (
        <div className="text-center mt-12">
          <button className="px-8 py-3 bg-white text-[#FF3B30] border-2 border-[#FF3B30] rounded-full font-semibold hover:bg-[#FF3B30] hover:text-white transition-all duration-300 shadow-lg">
            Load More Restaurants
          </button>
        </div>
      )} */}
    </section>
  );
};

export default RestaurantExplore;
