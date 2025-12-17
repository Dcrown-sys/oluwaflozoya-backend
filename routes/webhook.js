const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { finalizeDeliveryAfterPaymentAuto } = require('../controllers/deliveryController');

const FLW_SECRET_HASH = process.env.FLW_SECRET_HASH;

// Use raw body for signature verification
router.post(
  '/flutterwave-webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      console.log('🔔 Flutterwave webhook received');

      /* ======================================================
         1️⃣ VERIFY SIGNATURE
      ====================================================== */
      const signature = req.headers['verif-hash'];
      if (!signature || signature !== FLW_SECRET_HASH) {
        console.warn('❌ Invalid Flutterwave webhook signature');
        return res.status(401).send('Invalid signature');
      }
      console.log('✅ Signature verified');

      /* ======================================================
         2️⃣ PARSE PAYLOAD
      ====================================================== */
      let payload;
      try {
        payload = JSON.parse(req.body.toString());
      } catch (err) {
        console.error('❌ Invalid JSON payload', err);
        return res.status(400).send('Invalid JSON payload');
      }
      console.log('📦 Payload parsed:', payload);

      const { data, event } = payload;
      if (!data) return res.status(400).send('Missing data in payload');

      const txRef = data.tx_ref || null;
      const flwRef = data.flw_ref || data.id || null;
      const paymentReference = data.meta?.payment_reference || null;
      const flutterStatus = (data.status || '').toLowerCase();

      if (!txRef && !flwRef && !paymentReference) {
        return res.status(400).send('No identifiers provided');
      }

      console.log('📝 Identifiers:', { txRef, flwRef, paymentReference, flutterStatus });

      /* ======================================================
         3️⃣ MAP FLUTTERWAVE EVENT → INTERNAL STATUS
      ====================================================== */
      let newPaymentStatus = 'pending';

      if (event === 'charge.completed' && ['successful', 'completed'].includes(flutterStatus)) {
        newPaymentStatus = 'completed';
      } else if (['failed', 'cancelled'].includes(flutterStatus)) {
        newPaymentStatus = 'cancelled';
      }

      console.log('💡 Mapped payment status:', newPaymentStatus);

      /* ======================================================
         4️⃣ FETCH PAYMENT ROW
      ====================================================== */
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
        console.warn('⚠️ Payment row not found, ignoring webhook', { txRef, flwRef, paymentReference });
        return res.status(200).send('Ignored');
      }

      console.log('🔍 Found payment:', payment.id, payment.payment_type, payment.status);

      /* ======================================================
         5️⃣ IDEMPOTENCY CHECK
      ====================================================== */
      if (['completed', 'cancelled'].includes(payment.status)) {
        console.log(`ℹ️ Payment already processed: ${payment.id}, status: ${payment.status}`);
        return res.status(200).send('Already processed');
      }

      /* ======================================================
         6️⃣ UPDATE PAYMENT RECORD
      ====================================================== */
      await sql`
        UPDATE payments
        SET
          status = ${newPaymentStatus},
          flw_ref = ${flwRef || payment.flw_ref},
          updated_at = NOW()
        WHERE id = ${payment.id};
      `;

      console.log(`✅ Payment updated: ${payment.id}, new status: ${newPaymentStatus}`);

      /* ======================================================
         7️⃣ HANDLE DELIVERY PAYMENTS
      ====================================================== */
      if (payment.payment_type === 'delivery_fee' && newPaymentStatus === 'completed') {
        const orderId = payment.order_id;

        // Update delivery status
        const updatedDelivery = await sql`
          UPDATE deliveries
          SET status = 'en_route', updated_at = NOW()
          WHERE order_id = ${orderId} AND status = 'pending'
          RETURNING id;
        `;

        if (updatedDelivery.length > 0) {
          console.log(`📦 Delivery updated for order ${orderId}`);
        } else {
          console.warn(`⚠️ No pending delivery found for order ${orderId}`);
        }

        // Auto-assign courier
        try {
          await finalizeDeliveryAfterPaymentAuto(orderId);
          console.log(`🛵 Courier auto-assigned for order ${orderId}`);
        } catch (err) {
          console.error('❌ Courier auto-assignment failed:', err);
        }

        // Update order status
        await sql`
          UPDATE orders
          SET status = 'en_route', updated_at = NOW()
          WHERE id = ${orderId};
        `;
        console.log(`📝 Order updated to en_route: ${orderId}`);
      }

      console.log('🎯 Webhook fully processed for payment:', payment.id);
      return res.status(200).send('OK');

    } catch (err) {
      console.error('💥 Webhook processing error:', err);
      return res.status(500).send('Server error');
    }
  }
);

module.exports = router;
