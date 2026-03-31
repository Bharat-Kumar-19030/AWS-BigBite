// Utility to map an Order mongoose document to the socket 
// payload shape used across the app
export function mapOrderToSocketData(orderDoc) {
  if (!orderDoc) return null;

  // Defensive cloning with fallbacks to avoid crashes when optional data is missing
  const restaurantDetails = orderDoc.restaurant?.restaurantDetails || {};
  const restaurantAddress = restaurantDetails.address || {};
  const customer = orderDoc.customer || {};

  const items = (orderDoc.items || []).map((item) => {
    const menu = item.menuItem || {};
    return {
      menuItem: menu._id ? {
        _id: menu._id,
        name: menu.name,
        price: menu.price,
        image: menu.image,
        category: menu.category,
      } : null,
      name: menu.name || item.name || 'Unknown Item',
      price: menu.price || item.price || 0,
      quantity: item.quantity,
      _id: item._id,
    };
  });

  return {
    _id: orderDoc._id,
    orderId: orderDoc._id?.toString(),
    orderNumber: orderDoc.orderNumber,
    customerId: customer._id?.toString?.() || customer?.toString?.(),
    restaurantId: orderDoc.restaurant?._id?.toString?.() || orderDoc.restaurant?.toString?.(),
    customerName: customer.name,
    customerPhone: customer.phone,
    restaurantName: restaurantDetails.kitchenName,
    restaurantCoordinates: {
      latitude: restaurantAddress.latitude ?? 0,
      longitude: restaurantAddress.longitude ?? 0,
    },
    deliveryCoordinates: {
      latitude: orderDoc.deliveryAddress?.latitude ?? 0,
      longitude: orderDoc.deliveryAddress?.longitude ?? 0,
    },
    deliveryAddress: orderDoc.deliveryAddress,
    status: orderDoc.status,
    items,
    subtotal: orderDoc.subtotal,
    deliveryFee: orderDoc.deliveryFee,
    platformFee: orderDoc.platformFee,
    gst: orderDoc.gst,
    totalAmount: orderDoc.totalAmount,
    createdAt: orderDoc.createdAt,
    riderId: orderDoc.rider?._id?.toString?.() || orderDoc.rider?.toString?.() || null,
    riderDetails: orderDoc.rider ? {
      name: orderDoc.rider.name,
      phone: orderDoc.rider.phone,
    } : null,
    riderCoordinates: orderDoc.rider?.riderDetails?.currentLocation || null,
    distanceToRestaurant: 0,
  };
}
