# 🍔 BigBite – AI-Powered Real-Time Food Delivery Platform

![BigBite Banner](https://img.shields.io/badge/Status-Active-success) ![License](https://img.shields.io/badge/License-MIT-blue) ![Version](https://img.shields.io/badge/Version-1.0.0-orange)

**BigBite** is a scalable, real-time food delivery system with an integrated autonomous AI agent, designed to enable end-to-end automation of user interactions across customers, restaurants, and delivery partners.

---

## 🌟 Executive Summary

> "Developed a scalable, real-time food delivery system with an integrated autonomous AI agent, enabling end-to-end automation of user interactions across customers, restaurants, and delivery partners."

BigBite bridges the gap between craving and consumption through a seamless, highly reactive, and intelligent platform. With features ranging from **LangChain-powered Voice/Text AI Assistants** to **Haversine-based real-time Rider tracking**, this platform offers a complete solution tailored for modern food delivery demands.

---

## 🔥 Highlighted Platform Features

*   **🧠 Autonomous AI Agent:** Engineered an AI-driven agent using **LangChain** and **LangGraph** (via Google Gemini) to execute platform actions such as order placement, cart management, navigation, and review submission through **natural language and voice commands**. Translated user requirements into algorithmic workflows and tool-based execution pipelines for multi-step reasoning.
*   **🛠️ Modular Backend Architecture:** Designed and implemented using Node.js, Express, and MongoDB, supporting multi-role workflows (Customer, Restaurant, Rider) with **JWT-based authentication** and role-based access control. Applied clean coding practices and RESTful API design.
*   **⚡ Real-Time Socket Communication:** Built real-time pipelines using **Socket.IO** to handle live order tracking, rider assignment, and delivery updates, dramatically improving system responsiveness and reducing redundant API polling.
*   **💳 Secure Payment Processing:** Integrated **Razorpay** for reliable transaction handling within the order lifecycle, with fallback to Cash On Delivery.
*   **🛵 Dynamic Rider Earnings & Logistics:** Uses the Haversine formula to calculate exact distances, displaying real-time delivery distances (25km max radius) and auto-calculating rider earnings (₹10/km).
*   **⭐ Comprehensive Rating System:** Customers can rate both the food and the delivery experience. Real-time dynamic updates map directly to restaurant UI tiles.
*   **💝 Wishlist Management:** Save configurations and full carts as named wishlists for easy 1-click reordering later.

---

## 🏢 Services Provided

The platform uses a role-based access model to cater to three distinct user experiences:

### 🧑‍💼 For Customers
*   **AI Chatbot Assistant:** Talk or type to add items, clear carts, or check out autonomously.
*   **Geospatial Browsing:** View available restaurants based on actual GPS distance and availability.
*   **Wishlists (Favorites):** Save regular orders (like "Friday Pizza") to custom wishlists and reorder with a single click.
*   **Live Order Tracking:** Watch the rider approach on a live React Leaflet map with real-time updates.
*   **Feedback System:** Post-delivery rating prompts for both food quality and the delivery partner.

### 🏪 For Restaurants
*   **Live Dashboard:** Real-time Socket.IO connected interface with 5 management tabs: *Pending, Accepted, Assigned, Delivered, Rejected*.
*   **Menu Management:** Create, edit, and categorize menu items with visuals and vegetarian/non-vegetarian toggles.
*   **Kitchen Control:** Soft-toggle kitchen availability to temporarily halt incoming orders during rushes.
*   **Financial & Rating Analytics:** Live display of current ratings, reviews, and completed orders.

### 🛵 For Delivery Partners (Riders)
*   **Rider Dashboard:** Live tabbed navigation for *Available, Assigned, Completed* deliveries.
*   **Geo-Fenced Alerts:** Instant ping for available orders within a 25km radius.
*   **Earnings Tracker:** Live dashboard tracking total deliveries, lifetime earnings, and today's earnings calculated dynamically per km (₹10/km).
*   **Secure Handoffs:** 4-digit PIN verification system for both pickup (from restaurant) and handoff (to customer).
*   **Live Location Updates:** GPS tracking broadcasted to the customer dashboard in real-time.

---

## 🛠️ Technology Stack

| Domain | Technologies |
| :--- | :--- |
| **Frontend** | React 18, Vite, React Router, Tailwind CSS, Framer Motion, Axios, Socket.IO Client, React Leaflet |
| **Backend** | Node.js, Express.js, MongoDB, Mongoose, Passport.js, JWT, Socket.IO |
| **AI / NLP** | LangChain, LangGraph, Google Gemini Pro API, Web Speech API (Voice-to-Text) |
| **Integrations** | Razorpay (Payments), Cloudinary (Image Hosting) |

---

## 🚀 How to Use / Setup Guide

### 1. Prerequisites
Ensure you have the following installed:
- **Node.js** (v16 or higher)
- **MongoDB** (Local instance or Atlas URI)
- Git

### 2. Clone and Install Dependencies

Open a terminal and install dependencies for both frontend and backend:
```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 3. Environment Configuration
Create a `.env` file in both the `backend/` and `frontend/` directories using the exact templates provided below.

#### 📝 Backend Sample `.env` (`backend/.env`)
```env
# Server Configuration
PORT=5000
NODE_ENV=development

# Database
MONGODB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/bigbite?retryWrites=true&w=majority

# Authentication
JWT_SECRET=your_super_secret_jwt_key_here
PASSPORT_CLIENT_ID=your_google_oauth_client_id
PASSPORT_CLIENT_SECRET=your_google_oauth_secret

# Cloudinary (Image Uploads)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# AI Agent Config (Gemini/Groq)
GEMINI_API_KEY=your_google_gemini_api_key
GROQ_API_KEY=your_groq_api_key

# Payment Gateway
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
PAYMENT_SECRET=bigbite-payment-secret-2024
```

#### 📝 Frontend Sample `.env` (`frontend/.env`)
```env
# API & Socket Connections
VITE_SERVER_URL=http://localhost:5000
VITE_SOCKET_URL=http://localhost:5000

# Razorpay Checkout
VITE_RAZORPAY_KEY_ID=your_razorpay_key_id

# Cloudinary Integration
VITE_CLOUDINARY_CLOUD_NAME=your_cloud_name
VITE_CLOUDINARY_UPLOAD_PRESET=your_unsigned_upload_preset
```

### 4. Running the Application

Open two terminal windows/tabs:

**Terminal 1 (Backend):**
```bash
cd backend
npm run dev    # Or: node server.js
```

**Terminal 2 (Frontend):**
```bash
cd frontend
npm run dev
```

> **Access the App:** Open your browser and navigate to `http://localhost:5173` (or the port Vite provides).

---

## 🔧 Architecture & Event-Driven Patterns

*   **Socket Context:** Integrated deeply via a React Context (`SocketContext.jsx`). Handles automatic connection recovery and room management based on user roles and active order IDs.
*   **Order State Machine:** Orders flow strictly through logical status gates: `pending` → `accepted` → `awaiting_rider` → `rider_assigned` → `preparing` → `ready` → `picked_up` → `on_the_way` → `delivered`.
*   **Security:** Implements payload encryption for critical handoffs (like Razorpay secrets), extensive route protection via custom React wrappers, and robust `async/await` error-handling boundaries on Express controllers.

---
*Built with ❤️ and clean code.*
4. Restaurant updates → `preparing` → `ready` → `picked_up`
5. Rider updates → `on_the_way`
6. Rider marks → `delivered`

### Order Status States
- `pending` - Waiting for restaurant
- `accepted` - Restaurant confirmed
- `rider_assigned` - Rider accepted delivery
- `preparing` - Food being prepared
- `ready` - Ready for pickup
- `picked_up` - Rider collected order
- `on_the_way` - En route to customer
- `delivered` - Successfully delivered
- `cancelled` / `rejected` / `auto_rejected` - Order cancelled

## 🗺️ Socket Architecture

### Socket Rooms
- `order_{orderId}` - All parties join for order-specific updates
- `restaurant_{restaurantId}` - Restaurant receives new orders
- `rider_{riderId}` - Individual rider notifications

### Socket Events
- `new_order_received` - Restaurant gets new order
- `order_status_changed` - Status updates to all parties
- `new_order_available` - Riders notified of nearby orders
- `order_taken` - Remove order from available pool
- `rider_location_update` - GPS tracking every 10 seconds

## 📱 Components Overview

### Customer Components
- `RestaurantExplore.jsx` - Browse restaurants
- `RestaurantPage.jsx` - Menu and ordering
- `ViewCart.jsx` - Cart management
- `OrderTracking.jsx` - Live tracking
- `MyOrders.jsx` - Order history

### Restaurant Components
- `RestaurantDashboard.jsx` - Order management dashboard
- `RestaurantRegistration.jsx` - Restaurant onboarding
- `KitchenDetailsModal.jsx` - Kitchen info

### Rider Components
- `RiderDashboard.jsx` - Delivery management
- `RiderProfile.jsx` - Rider settings

### Shared Components
- `Navbar.jsx` - Navigation
- `LoginModal.jsx` / `SignupModal.jsx` - Authentication
- `Profile.jsx` - User settings
- `LocationPicker.jsx` - Address selection

## 🔐 Authentication

- JWT-based authentication
- Role-based access (customer, restaurant, rider)
- Protected routes
- Session persistence
- Auth context for global state

## 📍 Location Features

- Haversine distance calculation (25km radius for riders)
- Real-time GPS tracking
- OpenStreetMap integration via Leaflet
- Custom map markers for restaurant, customer, rider
- Location permission management

## 🎨 UI/UX Features

- Responsive design
- Smooth animations (Framer Motion)
- Toast notifications (React Hot Toast)
- Loading states
- Optimistic UI updates
- Inline modals to preserve state
- Real-time status badges

## 📝 License

This project is private and proprietary.

## 👥 Contributors

- Bharat

## 🐛 Known Issues & Future Enhancements

- Implement payment gateway integration
- Add review and rating system
- Implement earnings tracking for riders
- Add push notifications
- Implement order analytics dashboard
- Add restaurant search and filters
- Multi-language support

---

Built with ❤️ using React, Node.js, and Socket.IO
