const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { finalizeDeliveryAfterPaymentAuto } = require('../controllers/deliveryController');

const FLW_SECRET_HASH = process.env.FLW_SECRET_HASH;

// IMPORTANT: raw body required for Flutterwave signature verification
router.post(
  '/flutterwave-webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      // 1️⃣ LOG RAW WEBHOOK
      console.log('🌀 Flutterwave webhook received');
      console.log('Headers:', req.headers);
      console.log('Body (raw):', req.body.toString());

      // 2️⃣ VERIFY SIGNATURE
      const signature = req.headers['verif-hash'];
      if (!signature || signature !== FLW_SECRET_HASH) {
        console.warn('❌ Invalid Flutterwave webhook signature');
        return res.status(401).send('Invalid signature');
      }

      // 3️⃣ PARSE PAYLOAD
      let payload;
      try {
        payload = JSON.parse(req.body.toString());
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
      const flwRef = data.flw_ref || data.id || null;
      const paymentReference = data.meta?.payment_reference || null;
      const flutterStatus = (data.status || '').toLowerCase();

      if (!txRef && !flwRef && !paymentReference) {
        console.warn('⚠️ No identifiers provided in webhook');
        return res.status(400).send('No identifiers');
      }

      console.log('🔑 Identifiers:', { txRef, flwRef, paymentReference, flutterStatus });

      // 4️⃣ MAP FLUTTERWAVE STATUS → INTERNAL STATUS
      let newPaymentStatus = 'pending';

      // Treat any successful signal from Flutterwave as completed
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

      // 5️⃣ FETCH PAYMENT ROW
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

      // 6️⃣ IDEMPOTENCY CHECK
      if (['completed', 'cancelled'].includes(payment.status)) {
        console.log(`ℹ️ Payment already finalized: ${payment.id}`);
        return res.status(200).send('Already processed');
      }

      // 7️⃣ UPDATE PAYMENT RECORD
      const updatedPayment = await sql`
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

      // 8️⃣ HANDLE DELIVERY PAYMENT
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
