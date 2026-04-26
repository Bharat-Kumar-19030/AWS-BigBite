import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import api from '../services/api';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';

const PaymentCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [processing, setProcessing] = useState(true);
  const [paymentStatus, setPaymentStatus] = useState(null); // 'success' or 'failed'
  const { clearCart } = useApp();
  const { user, loading } = useAuth();
  const hasProcessed = useRef(false); // Prevent duplicate processing

  useEffect(() => {
    // Wait for auth to be ready after redirect from payment page
    if (loading) {
      console.log('⏳ Waiting for auth to load after payment redirect...');
      return;
    }

    // Prevent duplicate processing in React Strict Mode
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const handlePaymentCallback = async () => {
      try {
        const payment = searchParams.get('payment'); // 'success' or 'failed'
        const ref = searchParams.get('ref'); // order ID
        const razorpay_order_id = searchParams.get('razorpay_order_id');
        const razorpay_payment_id = searchParams.get('razorpay_payment_id');
        const razorpay_signature = searchParams.get('razorpay_signature');

        console.log('💳 Payment callback received:', { payment, ref, razorpay_payment_id });

        if (payment === 'success' && ref) {
          // Confirm the order with payment details
          toast.loading('Confirming your order...', { id: 'confirm-order' });

          const response = await api.confirmOrder(ref, {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
          });

          if (response.success) {
            setPaymentStatus('success');
            toast.success('Order placed successfully! 🎉', { id: 'confirm-order' });
            
            // Clear cart after successful order
            await clearCart();
            
            // Clear pending order from session
            sessionStorage.removeItem('pendingOrder');
            
            // Navigate to order tracking
            setTimeout(() => {
              navigate(`/track-order/${ref}`);
            }, 1000);
          } else {
            throw new Error('Failed to confirm order');
          }
        } else if (payment === 'failed') {
          setPaymentStatus('failed');
          toast.error('Payment failed. Please try again.', { id: 'confirm-order' });
          
          // Navigate back to cart so the user can retry
          setTimeout(() => {
            navigate('/cart');
          }, 2500);
        } else {
          toast.error('Invalid payment callback', { id: 'confirm-order' });
          navigate('/cart');
        }
      } catch (error) {
        console.error('❌ Payment callback error:', error);
        setPaymentStatus('failed');
        toast.error(error.message || 'Failed to process payment', { id: 'confirm-order' });
        
        setTimeout(() => {
          navigate('/cart');
        }, 2500);
      } finally {
        setProcessing(false);
      }
    };

    handlePaymentCallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]); // Wait for auth loading to complete

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-xl p-12 max-w-md text-center">
        {processing ? (
          <>
            <div className="w-20 h-20 mx-auto mb-6">
              <div className="animate-spin rounded-full h-20 w-20 border-b-4 border-orange-500"></div>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Processing Payment</h2>
            <p className="text-gray-600">Please wait while we confirm your order...</p>
          </>
        ) : paymentStatus === 'success' ? (
          <>
            <div className="w-20 h-20 mx-auto mb-6">
              <svg className="w-20 h-20 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Payment Successful</h2>
            <p className="text-gray-600">Redirecting to order tracking...</p>
          </>
        ) : (
          <>
            <div className="w-20 h-20 mx-auto mb-6">
              <svg className="w-20 h-20 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Payment Failed</h2>
            <p className="text-gray-600">Redirecting back to cart...</p>
          </>
        )}
      </div>
    </div>
  );
};

export default PaymentCallback;
