const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

class ApiService {
  constructor() {
    this.baseURL = API_BASE_URL;
  }

  // Check if JWT token is valid (not expired)
  isTokenValid() {
    const token = localStorage.getItem('bigbite_token');
    if (!token) return false;

    try {
      // Decode JWT payload (without verification)
      const payload = JSON.parse(atob(token.split('.')[1]));
      const expiry = payload.exp * 1000; // Convert to milliseconds
      const isValid = Date.now() < expiry;
      console.log('Token validation:', isValid ? 'Valid' : 'Expired', 'Expires:', new Date(expiry).toLocaleString());
      return isValid;
    } catch (error) {
      console.error('Token validation error:', error);
      return false;
    }
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    
    // Only check token validity for protected endpoints (skip for login/signup)
    const publicEndpoints = ['/auth/login', '/auth/signup', '/auth/google'];
    const isPublicEndpoint = publicEndpoints.some(ep => endpoint.includes(ep));
    
    if (!isPublicEndpoint && !this.isTokenValid()) {
      console.error('API Request blocked: Invalid or expired token');
      // Clear invalid token
      localStorage.removeItem('bigbite_token');
      throw new Error('Authentication required. Please log in again.');
    }
    
    const config = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      credentials: 'include', // Include cookies for cross-origin requests
      mode: 'cors', // Explicitly set CORS mode
    };

    // Add token from localStorage if available
    const token = localStorage.getItem('bigbite_token');
    console.log('API Request - Token:', token ? `${token.substring(0, 20)}...` : 'No token');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, config);
      const data = await response.json();

      if (!response.ok) {
        // If unauthorized, clear token and ask to re-login
        if (response.status === 401) {
          localStorage.removeItem('bigbite_token');
        }
        throw new Error(data.message || 'Something went wrong');
      }

      return data;
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }

  // Generic HTTP methods
  async get(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'GET' });
  }

  async post(endpoint, data = {}, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async put(endpoint, data = {}, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async delete(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'DELETE' });
  }

  // Auth endpoints
  async signup(userData) {
    return this.request('/auth/signup', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  }

  async login(credentials) {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
  }

  async logout() {
    return this.request('/auth/logout', {
      method: 'POST',
    });
  }

  async getMe() {
    return this.request('/auth/me');
  }

  async updateProfile(updates) {
    return this.request('/auth/update-profile', {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  // Google OAuth - open in new window
  googleLogin() {
    window.location.href = `${this.baseURL}/auth/google`;
  }

  // Wishlist endpoints
  async getWishlists() {
    return this.request('/wishlist');
  }

  // Order endpoints
  async placeOrder(orderData) {
    return this.request('/orders', {
      method: 'POST',
      body: JSON.stringify(orderData),
    });
  }

  async createPendingOrder(orderData) {
    return this.request('/orders/pending', {
      method: 'POST',
      body: JSON.stringify(orderData),
    });
  }

  async confirmOrder(orderId, paymentDetails) {
    return this.request(`/orders/${orderId}/confirm`, {
      method: 'POST',
      body: JSON.stringify(paymentDetails),
    });
  }

  // Payment endpoints
  async createPaymentOrder(amount, referenceId = null) {
    return this.request('/payment/create-order', {
      method: 'POST',
      body: JSON.stringify({ amount, referenceId }),
    });
  }

  async verifyPayment(paymentData) {
    return this.request('/payment/verify', {
      method: 'POST',
      body: JSON.stringify(paymentData),
    });
  }

  async getPaymentStatus(orderId) {
    return this.request(`/payment/status/${orderId}`);
  }

  // PIN Verification endpoints
  async verifyPickupPin(orderId, pin) {
    return this.request(`/orders/${orderId}/verify-pickup-pin`, {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
  }

  async verifyDeliveryPin(orderId, pin) {
    return this.request(`/orders/${orderId}/verify-delivery-pin`, {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
  }

  // Restaurant endpoints
  async getMenuItems() {
    return this.request('/restaurant/menu');
  }

  async addMenuItem(itemData) {
    return this.request('/restaurant/menu', {
      method: 'POST',
      body: JSON.stringify(itemData),
    });
  }

  async updateMenuItem(itemId, itemData) {
    return this.request(`/restaurant/menu/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify(itemData),
    });
  }

  async deleteMenuItem(itemId) {
    return this.request(`/restaurant/menu/${itemId}`, {
      method: 'DELETE',
    });
  }

  async toggleMenuItemAvailability(itemId) {
    return this.request(`/restaurant/menu/${itemId}/toggle`, {
      method: 'PATCH',
    });
  }

  async toggleKitchenStatus() {
    return this.request('/restaurant/toggle-kitchen', {
      method: 'PUT',
    });
  }

  // ── Chatbot Agent endpoints ──────────────────────────────────────────────────

  // Send message to autonomous agent
  async chatAgent(message, sessionId = null, latitude = null, longitude = null) {
    return this.request('/chatbot/agent', {
      method: 'POST',
      body: JSON.stringify({ message, sessionId, latitude, longitude }),
    });
  }

  // Load last conversation session
  async getChatSession() {
    return this.request('/chatbot/session');
  }

  // Create a new empty session
  async newChatSession() {
    return this.request('/chatbot/session/new', { method: 'POST', body: JSON.stringify({}) });
  }

  // List past sessions (titles)
  async listChatSessions() {
    return this.request('/chatbot/sessions');
  }
}

export default new ApiService();
