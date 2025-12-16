const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { finalizeDeliveryAfterPaymentAuto } = require('../controllers/deliveryController');

const FLW_SECRET_HASH = process.env.FLW_SECRET_HASH;

// IMPORTANT: raw body is required
router.post(
  '/flutterwave-webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      /* ======================================================
         1️⃣ VERIFY SIGNATURE (NON-NEGOTIABLE)
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
      if (!data?.tx_ref) {
        return res.status(400).send('Missing tx_ref');
      }

      const txRef = data.tx_ref;
      const flutterStatus = (data.status || '').toLowerCase();

      /* ======================================================
         3️⃣ MAP FLUTTERWAVE → INTERNAL STATUS
      ====================================================== */
      const SUCCESS_STATUSES = ['successful', 'completed', 'success'];
      const FAILURE_STATUSES = ['failed', 'cancelled'];
      
      let newPaymentStatus = 'pending';
      
      if (SUCCESS_STATUSES.includes(flutterStatus)) {
        newPaymentStatus = 'completed';
      } else if (FAILURE_STATUSES.includes(flutterStatus)) {
        newPaymentStatus = 'failed';
      }
      

      /* ======================================================
         4️⃣ FETCH PAYMENT (TX_REF IS SOURCE OF TRUTH)
      ====================================================== */
      const [payment] = await sql`
        SELECT *
        FROM payments
        WHERE tx_ref = ${txRef}
        LIMIT 1;
      `;

      if (!payment) {
        console.warn(`⚠️ No payment found for tx_ref: ${txRef}`);
        return res.status(200).send('Ignored');
      }

      /* ======================================================
         5️⃣ IDEMPOTENCY CHECK
      ====================================================== */
      if (payment.status === 'completed' || payment.status === 'cancelled') {
        console.log(`ℹ️ Payment ${txRef} already finalized`);
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
          updated_at = NOW()
        WHERE id = ${payment.id};
      `;

      /* ======================================================
         7️⃣ DELIVERY PAYMENT FLOW
      ====================================================== */
      if (
        payment.payment_type === 'delivery_fee' &&
        newPaymentStatus === 'completed'
      ) {
        const orderId = payment.order_id;

        /* ── 7a. Update delivery status ── */
        const updatedDelivery = await sql`
          UPDATE deliveries
          SET status = 'en_route', updated_at = NOW()
          WHERE order_id = ${orderId}
            AND status = 'pending'
          RETURNING id;
        `;

        if (updatedDelivery.length === 0) {
          console.warn(`⚠️ No pending delivery found for order ${orderId}`);
        }

        /* ── 7b. Auto-assign courier (ONCE) ── */
        try {
          const [{ count }] = await sql`
  SELECT COUNT(*)::int AS count
  FROM deliveries
  WHERE order_id = ${orderId}
    AND status = 'en_route';
`;

if (count === 1) {
  await finalizeDeliveryAfterPaymentAuto(orderId);
}

        } catch (err) {
          console.error('❌ Courier auto-assignment failed:', err);
        }
      }

      /* ======================================================
         8️⃣ ORDER STATUS (OPTIONAL, DELIVERY-AWARE)
      ====================================================== */
      if (
        payment.payment_type === 'delivery_fee' &&
        newPaymentStatus === 'completed'
      ) {
        await sql`
          UPDATE orders
          SET status = 'en_route', updated_at = NOW()
          WHERE id = ${payment.order_id};
        `;
      }

      /* ======================================================
         9️⃣ DONE
      ====================================================== */
      console.log(`✅ Webhook processed for tx_ref: ${txRef}`);
      return res.status(200).send('OK');

    } catch (err) {
      console.error('💥 Webhook processing error:', err);
      return res.status(500).send('Server error');
    }
  }
);

module.exports = router;
