import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { AppProvider } from './context/AppContext.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { SocketProvider } from './contexts/SocketContext.jsx';
import { Toaster } from 'react-hot-toast';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <AppProvider>
        <SocketProvider>
          <App />
          <Toaster 
            position="top-right" 
            reverseOrder={false}
            containerStyle={{
              top: 80,
            }}
            toastOptions={{
              duration: 3000,
              style: {
                background: '#fff',
                color: '#333',
                padding: '16px',
                borderRadius: '8px',
                boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                borderBottom: '4px solid #3b82f6',
              },
              success: {
                icon: null,
                style: {
                  background: '#fff',
                  color: '#333',
                  borderBottom: '4px solid #22c55e',
                },
              },
              error: {
                icon: null,
                style: {
                  background: '#fff',
                  color: '#333',
                  borderBottom: '4px solid #ef4444',
                },
              },
              loading: {
                icon: null,
                style: {
                  background: '#fff',
                  color: '#333',
                  borderBottom: '4px solid #3b82f6',
                },
              },
            }}
          />
        </SocketProvider>
      </AppProvider>
    </AuthProvider>
  </StrictMode>
);
