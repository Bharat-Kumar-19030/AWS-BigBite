// paymentHandlers.js — exportable handlers for agent tools
import crypto from 'crypto';
import Razorpay from 'razorpay';
import Payment from '../models/Payment.js';
import express from 'express';
import { protect } from '../middleware/auth.js';
const router = express.Router();
// ─── Lazy Razorpay Init ───────────────────────────────────────────
let razorpay = null;
let razorpayInitialized = false;

const initializeRazorpay = () => {
  if (razorpayInitialized) return;
  const KEY_ID     = process.env.RAZORPAY_KEY_ID?.trim();
  const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (KEY_ID && KEY_SECRET) {
    razorpay = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });
    console.log('✅ Razorpay initialized');
  } else {
    console.warn('⚠️ Razorpay credentials not configured.');
  }
  razorpayInitialized = true;
};

// ─── POST /api/payment/create-order ──────────────────────────────
// Access: Public (no auth required)
export const createPaymentOrderHandler = async (req, res) => {
  try {
    initializeRazorpay();

    if (!razorpay) {
      return res.status(503).json({
        success: false,
        message: 'Payment gateway not configured. Please use Cash on Delivery.',
      });
    }

    const { amount, referenceId } = req.body;
    const customerId = req.user?.id || 'guest';

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }

    const amountInPaise = Math.round(amount * 100);
    const receiptId = referenceId
      ? `edu_proj_${referenceId}`
      : `edu_proj_${Date.now()}_${customerId.slice(-6)}`;

    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: receiptId,
      notes: {
        category: 'service',
        purpose: 'educational project demo',
        type: 'digital_service',
      },
    });

    const payment = new Payment({
      razorpay_order_id: razorpayOrder.id,
      amount: amountInPaise,
      currency: 'INR',
      status: 'CREATED',
      customer: customerId,
      referenceId,
      notes: {
        category: 'service',
        purpose: 'educational project demo',
        type: 'digital_service',
      },
    });

    await payment.save();

    res.status(200).json({
      success: true,
      order: {
        id: razorpayOrder.id,
        amount: amountInPaise,
        currency: razorpayOrder.currency,
      },
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error('❌ Error creating payment order:', error);
    res.status(500).json({ success: false, message: 'Failed to create payment order', error: error.message });
  }
};

// ─── POST /api/payment/verify ─────────────────────────────────────
// Access: Public (called after Razorpay checkout)
export const verifyPaymentHandler = async (req, res) => {
  try {
    initializeRazorpay();

    if (!razorpay) {
      return res.status(503).json({ success: false, message: 'Payment gateway not configured.' });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Missing payment details' });
    }

    const payment = await Payment.findOne({ razorpay_order_id });

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment record not found' });
    }

    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature === razorpay_signature) {
      payment.razorpay_payment_id = razorpay_payment_id;
      payment.razorpay_signature  = razorpay_signature;
      payment.status = 'SUCCESS';
      await payment.save();

      res.status(200).json({
        success: true,
        message: 'Payment verified successfully',
        paymentId: razorpay_payment_id,
      });
    } else {
      payment.status = 'FAILED';
      await payment.save();

      res.status(400).json({ success: false, message: 'Payment verification failed' });
    }
  } catch (error) {
    console.error('❌ Error verifying payment:', error);
    res.status(500).json({ success: false, message: 'Error verifying payment', error: error.message });
  }
};

// ─── GET /api/payment/status/:orderId ────────────────────────────
// Access: Private (authenticated user)
export const getPaymentStatusHandler = async (req, res) => {
  try {
    const { orderId } = req.params;

    const payment = await Payment.findOne({ razorpay_order_id: orderId });

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    res.status(200).json({
      success: true,
      payment: {
        orderId:   payment.razorpay_order_id,
        paymentId: payment.razorpay_payment_id,
        amount:    payment.amount / 100, // back to ₹
        status:    payment.status,
        createdAt: payment.createdAt,
      },
    });
  } catch (error) {
    console.error('❌ Error fetching payment status:', error);
    res.status(500).json({ success: false, message: 'Error fetching payment status', error: error.message });
  }
};

// POST /api/payment/create-order — Public
router.post('/create-order', createPaymentOrderHandler);

// POST /api/payment/verify — Public
router.post('/verify', verifyPaymentHandler);

// GET /api/payment/status/:orderId — Private
router.get('/status/:orderId', protect, getPaymentStatusHandler);

export default router;