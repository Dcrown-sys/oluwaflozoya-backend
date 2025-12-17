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
      /* ======================================================
         1️⃣ VERIFY FLUTTERWAVE SIGNATURE
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
        return res.status(400).send('Invalid JSON payload');
      }

      const { data } = payload;
      if (!data) {
        return res.status(400).send('Missing data');
      }

      const txRef = data.tx_ref || null;
      const flwRef = data.flw_ref || data.id || null;
      const paymentReference = data.meta?.payment_reference || null;
      const flutterStatus = (data.status || '').toLowerCase();

      if (!txRef && !flwRef && !paymentReference) {
        return res.status(400).send('No identifiers provided');
      }

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
         4️⃣ FETCH PAYMENT (ROBUST MATCHING)
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
        console.warn(
          '⚠️ Payment not found',
          { txRef, flwRef, paymentReference }
        );
        return res.status(200).send('Ignored');
      }

      /* ======================================================
         5️⃣ IDEMPOTENCY CHECK
      ====================================================== */
      if (['completed', 'cancelled'].includes(payment.status)) {
        console.log(`ℹ️ Payment already processed: ${payment.id}`);
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

      /* ======================================================
         7️⃣ HANDLE DELIVERY PAYMENT (CRITICAL PART)
      ====================================================== */
      if (payment.payment_type === 'delivery_fee' && newPaymentStatus === 'completed') {
        const orderId = payment.order_id;

        // Update delivery
        await sql`
          UPDATE deliveries
          SET status = 'en_route', updated_at = NOW()
          WHERE order_id = ${orderId} AND status = 'pending';
        `;

        // Auto-assign courier (safe to retry)
        try {
          await finalizeDeliveryAfterPaymentAuto(orderId);
        } catch (err) {
          console.error('❌ Courier auto-assignment failed:', err);
        }

        // Update order
        await sql`
          UPDATE orders
          SET status = 'en_route', updated_at = NOW()
          WHERE id = ${orderId};
        `;
      }

      console.log(
        '✅ Flutterwave webhook processed',
        {
          payment_id: payment.id,
          status: newPaymentStatus,
          txRef,
          flwRef,
          paymentReference
        }
      );

      return res.status(200).send('OK');

    } catch (err) {
      console.error('💥 Flutterwave webhook error:', err);
      return res.status(500).send('Server error');
    }
  }
);

module.exports = router;
