// routes/webhookRoutes.js
const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { finalizeDeliveryAfterPaymentAuto } = require('../controllers/deliveryController');
const crypto = require('crypto');

const FLW_SECRET_HASH = process.env.FLW_SECRET_HASH;

// Use raw body parser for Flutterwave webhook
router.post(
  '/flutterwave-webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      console.log('🌀 Flutterwave webhook received');

      // 1️⃣ Log headers
      console.log('Headers:', req.headers);

      // 2️⃣ Capture raw payload
      const rawPayload = req.body.toString();
      console.log('Body (raw):', rawPayload);

      // 3️⃣ Compute HMAC SHA256 using your FLW_SECRET_HASH
      const hash = crypto.createHmac('sha256', FLW_SECRET_HASH)
                         .update(rawPayload)
                         .digest('hex');

      const signature = req.headers['verif-hash'];

      if (!signature || signature !== hash) {
        console.warn('❌ Invalid Flutterwave webhook signature', signature, hash);
        return res.status(401).send('Invalid signature');
      }
      console.log('✅ Webhook signature verified');

      // 4️⃣ Parse JSON payload
      let payload;
      try {
        payload = JSON.parse(rawPayload);
      } catch (err) {
        console.error('❌ Invalid JSON payload:', err);
        return res.status(400).send('Invalid JSON');
      }
      console.log('💡 Parsed payload:', JSON.stringify(payload));

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

      // 5️⃣ Map Flutterwave status to internal status
      let newPaymentStatus = 'pending';
      if (
        ['charge.completed', 'payment.completed'].includes(event) &&
        ['successful', 'success', 'completed'].includes(flutterStatus)
      ) {
        newPaymentStatus = 'completed';
      } else if (['failed', 'cancelled'].includes(flutterStatus)) {
        newPaymentStatus = 'cancelled';
      }
      console.log('💠 Mapped newPaymentStatus:', newPaymentStatus);

      // 6️⃣ Fetch payment row
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
        console.warn('⚠️ No payment found for webhook', { txRef, flwRef, paymentReference });
        return res.status(200).send('Ignored');
      }

      // 7️⃣ Idempotency check
      if (['completed', 'cancelled'].includes(payment.status)) {
        console.log(`ℹ️ Payment already finalized: ${payment.id}`);
        return res.status(200).send('Already processed');
      }

      // 8️⃣ Update payment record
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

      // 9️⃣ Handle delivery payment completion
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
