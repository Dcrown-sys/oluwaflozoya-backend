// routes/flutterwaveWebhook.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { sql } = require('../db');
const { finalizeDeliveryAfterPaymentAuto } = require('../controllers/deliveryController');

// IMPORTANT: Use raw body parser for Flutterwave webhook
router.post(
  '/flutterwave-webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      console.log('🌀 Flutterwave webhook received');

      // 1️⃣ Capture headers and raw body
      const signature = req.headers['verif-hash'];
      const rawBody = req.body.toString();
      console.log('Headers:', req.headers);
      console.log('Raw body:', rawBody);

      // 2️⃣ Compute HMAC SHA256 using FLW_SECRET_KEY
      const hash = crypto
        .createHmac('sha256', process.env.FLW_SECRET_KEY)
        .update(rawBody)
        .digest('hex');

      console.log('Computed hash:', hash);

      // 3️⃣ Verify signature
      if (!signature || signature !== hash) {
        console.warn('❌ Invalid webhook signature', signature, hash);
        return res.status(401).send('Invalid signature');
      }

      // 4️⃣ Parse JSON payload
      let payload;
      try {
        payload = JSON.parse(rawBody);
      } catch (err) {
        console.error('❌ Failed to parse JSON payload:', err);
        return res.status(400).send('Invalid JSON');
      }

      console.log('💡 Parsed payload:', JSON.stringify(payload));

      const { event, data } = payload;
      if (!data) {
        console.warn('⚠️ No data in webhook payload');
        return res.status(400).send('Missing data');
      }

      const txRef = data.tx_ref;
      const flwRef = data.id;
      const paymentType = data.meta?.payment_type || null;
      const flutterStatus = (data.status || '').toLowerCase();

      console.log('Identifiers:', { txRef, flwRef, paymentType, flutterStatus });

      // 5️⃣ Map Flutterwave status to internal payment status
      let newStatus = 'pending';
      if (['charge.completed', 'payment.completed'].includes(event) &&
          ['successful', 'success', 'completed'].includes(flutterStatus)) {
        newStatus = 'completed';
      } else if (['failed', 'cancelled'].includes(flutterStatus)) {
        newStatus = 'cancelled';
      }

      console.log('💠 Mapped internal status:', newStatus);

      // 6️⃣ Fetch payment record
      const [payment] = await sql`
        SELECT * FROM payments
        WHERE tx_ref = ${txRef} OR flw_ref = ${flwRef}
        LIMIT 1;
      `;

      if (!payment) {
        console.warn('⚠️ No payment record found for webhook', { txRef, flwRef });
        return res.status(200).send('Ignored');
      }

      // 7️⃣ Idempotency check
      if (['completed', 'cancelled'].includes(payment.status)) {
        console.log(`ℹ️ Payment already processed: ${payment.id}`);
        return res.status(200).send('Already processed');
      }

      // 8️⃣ Update payment record
      const updatedPayment = await sql`
        UPDATE payments
        SET status = ${newStatus},
            flw_ref = ${flwRef},
            amount = ${data.amount || payment.amount},
            currency = ${data.currency || payment.currency},
            updated_at = NOW()
        WHERE id = ${payment.id}
        RETURNING *;
      `;
      console.log('✅ Updated payment:', updatedPayment);

      // 9️⃣ Handle delivery-specific logic
      if (payment.payment_type === 'delivery_fee' && newStatus === 'completed') {
        const orderId = payment.order_id;

        // Update delivery status
        const updatedDelivery = await sql`
          UPDATE deliveries
          SET status = 'en_route', updated_at = NOW()
          WHERE order_id = ${orderId} AND status = 'pending'
          RETURNING id;
        `;
        console.log('🚚 Delivery updated:', updatedDelivery);

        // Auto-assign courier safely
        try {
          await finalizeDeliveryAfterPaymentAuto(orderId);
          console.log('🤝 Courier auto-assigned for order', orderId);
        } catch (err) {
          console.error('❌ Courier auto-assignment failed:', err);
        }

        // Update order status
        await sql`
          UPDATE orders
          SET status = 'en_route', updated_at = NOW()
          WHERE id = ${orderId};
        `;
        console.log(`📦 Order ${orderId} marked as en_route`);
      }

      console.log(`✅ Webhook processed successfully for payment ${payment.id}`);
      res.status(200).send('OK');

    } catch (err) {
      console.error('💥 Webhook processing error:', err);
      res.status(500).send('Server error');
    }
  }
);

module.exports = router;
