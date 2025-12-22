// routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const crypto = require('crypto');
const { finalizeDeliveryAfterPaymentAuto } = require('../controllers/deliveryController');

const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;

// 🟢 Buyer initiates a new delivery payment
const { payOrderDelivery, confirmPayment } = require('../controllers/paymentsController');
const { verifyBuyer } = require('../middleware/auth');

router.post('/order/:orderId', verifyBuyer, payOrderDelivery);
router.post('/confirm-payment', confirmPayment);

// ========================
// Flutterwave Webhook Route
// ========================
router.post(
  '/flutterwave-webhook',
  express.raw({ type: 'application/json' }), // raw body required
  async (req, res) => {
    try {
      // 1️⃣ Log webhook
      console.log('🌀 Flutterwave webhook received');
      console.log('Headers:', req.headers);
      console.log('Raw body:', req.body.toString());

      // 2️⃣ Verify signature
      const signature = req.headers['verif-hash'] || req.headers['verif_hash'];
      if (!signature) {
        console.warn('❌ No signature provided');
        return res.status(401).send('No signature');
      }

      const payload = req.body.toString();
      const hash = crypto.createHmac('sha256', FLW_SECRET_KEY)
                         .update(payload)
                         .digest('hex');

      if (signature !== hash) {
        console.warn('❌ Invalid signature', signature, hash);
        return res.status(401).send('Invalid signature');
      }

      console.log('✅ Webhook signature verified');

      // 3️⃣ Parse payload
      let body;
      try {
        body = JSON.parse(payload);
      } catch (err) {
        console.error('❌ Invalid JSON payload', err);
        return res.status(400).send('Invalid JSON');
      }

      const { event, data } = body;
      if (!data) {
        console.warn('⚠️ Missing data in payload');
        return res.status(400).send('Missing data');
      }

      console.log('💡 Parsed payload:', JSON.stringify(body));

      // 4️⃣ Identify payment
      const txRef = data.tx_ref || null;
      const flwRef = data.id || null;
      const flutterStatus = (data.status || '').toLowerCase();

      console.log('🔑 Identifiers:', { txRef, flwRef, flutterStatus });

      // 5️⃣ Determine new status
      let newPaymentStatus = 'pending';
      if (
        ['charge.completed', 'payment.completed'].includes(event) &&
        ['successful', 'success', 'completed'].includes(flutterStatus)
      ) {
        newPaymentStatus = 'completed';
      }
      if (['failed', 'cancelled'].includes(flutterStatus)) {
        newPaymentStatus = 'cancelled';
      }

      console.log('💠 Mapped newPaymentStatus:', newPaymentStatus);

      // 6️⃣ Fetch payment row
      const [payment] = await sql`
        SELECT * FROM payments
        WHERE tx_ref = ${txRef} OR flw_ref = ${flwRef}
        LIMIT 1;
      `;

      if (!payment) {
        console.warn('⚠️ Payment not found', { txRef, flwRef });
        return res.status(200).send('Ignored');
      }

      // 7️⃣ Idempotency check
      if (['completed', 'cancelled'].includes(payment.status)) {
        console.log(`ℹ️ Payment already finalized: ${payment.id}`);
        return res.status(200).send('Already processed');
      }

      // 8️⃣ Update payment row
      const updatedPayment = await sql`
        UPDATE payments
        SET status = ${newPaymentStatus},
            flw_ref = ${flwRef || payment.flw_ref},
            amount = ${data.amount || payment.amount},
            currency = ${data.currency || payment.currency},
            updated_at = NOW()
        WHERE id = ${payment.id}
        RETURNING *;
      `;

      console.log('✅ Updated payment:', updatedPayment);

      // 9️⃣ Handle delivery payment
      if (payment.payment_type === 'delivery_fee' && newPaymentStatus === 'completed') {
        const orderId = payment.order_id;

        // Update delivery status
        const updatedDelivery = await sql`
          UPDATE deliveries
          SET status = 'en_route', updated_at = NOW()
          WHERE order_id = ${orderId} AND status = 'pending'
          RETURNING id;
        `;

        if (updatedDelivery.length === 0) {
          console.warn(`⚠️ No pending delivery found for order ${orderId}`);
        } else {
          console.log('🚚 Delivery updated:', updatedDelivery);
        }

        // Auto-assign courier
        try {
          await finalizeDeliveryAfterPaymentAuto(orderId);
          console.log('🤝 Courier auto-assigned');
        } catch (err) {
          console.error('❌ Courier auto-assignment failed:', err);
        }

        // Update order status
        await sql`
          UPDATE orders
          SET status = 'en_route', updated_at = NOW()
          WHERE id = ${orderId};
        `;
        console.log(`📦 Order ${orderId} marked en_route`);
      }

      console.log(`✅ Webhook processed successfully for payment ${payment.id}`);
      return res.status(200).send('OK');
    } catch (err) {
      console.error('💥 Webhook processing error:', err);
      return res.status(500).send('Server error');
    }
  }
);

module.exports = router;
