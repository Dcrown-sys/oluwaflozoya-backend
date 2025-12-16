const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { finalizeDeliveryAfterPaymentAuto } = require('../controllers/deliveryController');

const FLW_SECRET_HASH = process.env.FLW_SECRET_HASH;

// IMPORTANT: raw body is required for signature verification
router.post(
  '/flutterwave-webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      /* ======================================================
         1️⃣ VERIFY SIGNATURE
      ====================================================== */
      const signature = req.headers['verif-hash'];
      if (!signature || signature !== FLW_SECRET_HASH) {
        console.warn('❌ Invalid Flutterwave webhook signature');
        return res.status(401).send('Invalid signature');
      }

      /* ======================================================
         2️⃣ PARSE PAYLOAD
      ====================================================== */
      let payload;
      try {
        payload = JSON.parse(req.body.toString());
      } catch {
        return res.status(400).send('Invalid JSON');
      }

      const { event, data } = payload;
      if (!data?.tx_ref && !data?.meta?.payment_reference) {
        return res.status(400).send('Missing tx_ref or payment_reference');
      }

      const txRef = data.tx_ref;
      const paymentReference = data.meta?.payment_reference;
      const flutterStatus = (data.status || '').toLowerCase();

      /* ======================================================
         3️⃣ MAP FLUTTERWAVE STATUS → INTERNAL STATUS
      ====================================================== */
      let newPaymentStatus = 'pending';
      if (['successful', 'completed'].includes(flutterStatus)) {
        newPaymentStatus = 'completed';
      } else if (['failed', 'cancelled'].includes(flutterStatus)) {
        newPaymentStatus = 'cancelled';
      }

      /* ======================================================
         4️⃣ FETCH PAYMENT (USE payment_reference OR tx_ref)
      ====================================================== */
      const [payment] = await sql`
        SELECT *
        FROM payments
        WHERE ${paymentReference ? sql`payment_reference = ${paymentReference}` : sql`tx_ref = ${txRef}`}
        LIMIT 1;
      `;

      if (!payment) {
        console.warn(`⚠️ No payment found for tx_ref: ${txRef} or payment_reference: ${paymentReference}`);
        return res.status(200).send('Ignored');
      }

      /* ======================================================
         5️⃣ IDEMPOTENCY CHECK
      ====================================================== */
      if (payment.status === 'completed' || payment.status === 'cancelled') {
        console.log(`ℹ️ Payment ${payment.tx_ref} already finalized`);
        return res.status(200).send('Already processed');
      }

      /* ======================================================
         6️⃣ UPDATE PAYMENT RECORD
      ====================================================== */
      await sql`
        UPDATE payments
        SET
          status = ${newPaymentStatus},
          amount = ${data.amount || payment.amount},
          currency = ${data.currency || payment.currency},
          flw_ref = ${data.id || payment.flw_ref},
          updated_at = NOW()
        WHERE id = ${payment.id};
      `;

      /* ======================================================
         7️⃣ HANDLE DELIVERY PAYMENT
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

        if (updatedDelivery.length === 0) {
          console.warn(`⚠️ No pending delivery found for order ${orderId}`);
        }

        // Auto-assign courier (ONCE)
        try {
          await finalizeDeliveryAfterPaymentAuto(orderId);
        } catch (err) {
          console.error('❌ Courier auto-assignment failed:', err);
        }

        // Update order status
        await sql`
          UPDATE orders
          SET status = 'en_route', updated_at = NOW()
          WHERE id = ${orderId};
        `;
      }

      console.log(`✅ Webhook processed for tx_ref: ${payment.tx_ref}, payment_reference: ${payment.payment_reference}`);
      return res.status(200).send('OK');

    } catch (err) {
      console.error('💥 Webhook processing error:', err);
      return res.status(500).send('Server error');
    }
  }
);

module.exports = router;
