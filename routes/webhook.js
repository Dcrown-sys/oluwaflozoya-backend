const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { finalizeDeliveryAfterPaymentAuto } = require('../controllers/deliveryController');
const crypto = require('crypto');

// Middleware to save raw body for HMAC verification
const rawBodySaver = (req, res, buf, encoding) => {
  if (buf && buf.length) {
    req.rawBody = buf;
  }
};

// 🟢 Flutterwave webhook route
router.post(
  '/flutterwave-webhook',
  express.raw({ type: 'application/json', verify: rawBodySaver }),
  async (req, res) => {
    try {
      console.log('🌀 Flutterwave webhook received');

      // 1️⃣ Headers
      console.log('Headers:', JSON.stringify(req.headers, null, 2));

      // 2️⃣ Raw body (should now be a Buffer)
      const rawBody = req.rawBody;
      console.log('Raw body type:', rawBody ? rawBody.constructor.name : 'undefined');
      console.log('Raw body length:', rawBody ? rawBody.length : 'undefined');
      if (!rawBody) {
        console.error('❌ Raw body not captured');
        return res.status(400).send('Invalid request');
      }

      // 3️⃣ Verify signature using Flutterwave secret key
      const signature = req.headers['verif-hash'];
      const secret = process.env.FLW_SECRET_KEY;

      if (!secret) {
        console.error('❌ FLW_SECRET_KEY not set');
        return res.status(500).send('Server configuration error');
      }

      const hash = crypto.createHmac('sha256', secret)
                         .update(rawBody)
                         .digest('hex');

      console.log('Received signature:', signature);
      console.log('Calculated hash  :', hash);

      if (!signature || signature !== hash) {
        console.warn('❌ Invalid webhook signature');
        return res.status(401).send('Invalid signature');
      }

      console.log('✅ Signature verified');

      // 4️⃣ Parse JSON AFTER verification
      let payload;
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch (err) {
        console.error('❌ Invalid JSON payload:', err);
        return res.status(400).send('Invalid JSON');
      }

      console.log('💡 Parsed payload:', JSON.stringify(payload, null, 2));

      // 5️⃣ Extract relevant info
      const { event, data } = payload;
      if (!data) {
        console.warn('⚠️ Missing data in payload');
        return res.status(400).send('Missing data');
      }

      const txRef = data.tx_ref || null;
      const flwRef = data.id || null;
      const paymentReference = data.meta?.payment_reference || null;
      const flutterStatus = (data.status || '').toLowerCase();

      console.log('🔑 Identifiers:', { txRef, flwRef, paymentReference, flutterStatus });

      // 6️⃣ Map Flutterwave status → internal status
      let newPaymentStatus = 'pending';
      if (['charge.completed', 'payment.completed'].includes(event) &&
          ['successful', 'success', 'completed'].includes(flutterStatus)) {
        newPaymentStatus = 'completed';
      }
      if (['failed', 'cancelled'].includes(flutterStatus)) {
        newPaymentStatus = 'cancelled';
      }

      console.log('💠 Mapped payment status:', newPaymentStatus);

      // 7️⃣ Fetch payment row
      const [payment] = await sql`
        SELECT *
        FROM payments
        WHERE
          (${txRef} IS NOT NULL AND tx_ref = ${txRef})
          OR (${paymentReference} IS NOT NULL AND payment_reference = ${paymentReference})
          OR (${flwRef} IS NOT NULL AND flw_ref = ${flwRef})
        LIMIT 1;
      `;

      if (!payment) {
        console.warn('⚠️ No payment found for webhook');
        return res.status(200).send('Ignored');
      }

      console.log('💳 Found payment:', payment.id);

      // 8️⃣ Idempotency check
      if (['completed', 'cancelled'].includes(payment.status)) {
        console.log(`ℹ️ Payment already finalized: ${payment.id}`);
        return res.status(200).send('Already processed');
      }

      // 9️⃣ Update payment record
      const [updatedPayment] = await sql`
        UPDATE payments
        SET
          status = ${newPaymentStatus},
          flw_ref = ${flwRef || payment.flw_ref},
          amount = ${data.amount || payment.amount},
          currency = ${data.currency || payment.currency},
          updated_at = NOW()
        WHERE id = ${payment.id}
        RETURNING *;
      `;

      console.log('✅ Updated payment row:', updatedPayment);

      // 🔟 Handle delivery payment
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

        // Auto-assign courier (retry safe)
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