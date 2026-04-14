import Navbar from './components/Navbar';
import Hero from './components/Hero';
import RestaurantExplore from './components/RestaurantExplore';
import PartnerSection from './components/PartnerSection';
import Footer from './components/Footer';
import LoginModal from './components/LoginModal';
import SignupModal from './components/SignupModal';
import KitchenDetailsModal from './components/KitchenDetailsModal';
import Profile from './components/Profile';
import RestaurantDashboard from './components/RestaurantDashboard';
import RestaurantPage from './components/RestaurantPage';
import RestaurantRegistration from './components/RestaurantRegistration';
import RiderRegistration from './components/RiderRegistration';
import ViewCart from './components/ViewCart';
import WishlistManager from './components/WishlistManager';
import RiderDashboard from './components/RiderDashboard';
import MyOrders from './components/MyOrders';
import OrderTracking from './components/OrderTracking';
import PaymentCallback from './components/PaymentCallback';
import Chatbot from './components/Chatbot';
import AboutUs from './components/AboutUs';
import PrivacyPolicy from './components/PrivacyPolicy';
import { BrowserRouter as  Router,Routes,Route } from "react-router-dom";
import { useAuth } from './context/AuthContext';
import Tester from './components/tester';
function App() {
  const { showLoginModal, showSignupModal, showKitchenDetailsModal, loading } = useAuth();
  
  // Show loading screen while checking authentication
  // if (loading) {
  //   return (
  //     <div className="min-h-screen bg-white flex items-center justify-center">
        
  //       <div className="text-center">
  //         <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-500 mx-auto mb-4"></div>
  //         <p className="text-gray-600">Loading...</p>
  //       </div>
  //     </div>
  //   );
  // }
  
  return (
    <div className="min-h-screen bg-white">
      <Router>
      <Navbar />
      <Routes>
        <Route path="/" element={
           <><Hero /><RestaurantExplore /><PartnerSection /></>
        } />
        <Route path="/test" element={<Tester/>}/>
        <Route path="/about" element={<AboutUs/>}/>
        <Route path="/privacy-policy" element={<PrivacyPolicy/>}/>
        <Route path="/profile" element={<Profile/>}/>
        <Route path="/cart" element={<ViewCart/>}/>
        <Route path="/wishlists" element={<WishlistManager/>}/>
        <Route path="/orders" element={<MyOrders/>}/>
        <Route path="/track-order/:orderId" element={<OrderTracking/>}/>
        <Route path="/payment-callback" element={<PaymentCallback/>}/>
        <Route path="/restaurant-dashboard" element={<RestaurantDashboard/>}/>
        <Route path="/restaurant-registration" element={<RestaurantRegistration/>}/>
        <Route path="/rider-registration" element={<RiderRegistration/>}/>
        <Route path="/restaurant/:restaurantId" element={<RestaurantPage/>}/>
        <Route path="/restaurant/:restaurantId/item/:itemId" element={<RestaurantPage/>}/>
        <Route path="/rider/dashboard" element={<RiderDashboard/>}/>
        <Route path="/rider-profile" element={<RiderDashboard/>}/>
      </Routes>
      <Footer />
      
      {/* Modals */}
      {showLoginModal && <LoginModal />}
      {showSignupModal && <SignupModal />}
      {showKitchenDetailsModal && <KitchenDetailsModal />}
      
      {/* Chatbot - Available on all pages */}
      <Chatbot />
      </Router>
    </div>
  );
}

export default App;
