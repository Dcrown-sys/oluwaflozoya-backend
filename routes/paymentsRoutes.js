// routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { finalizeDeliveryAfterPaymentAuto } = require('../controllers/deliveryController');
const { payOrderDelivery, confirmPayment } = require('../controllers/paymentsController');
const { verifyBuyer } = require('../middleware/auth');

const FLW_WEBHOOK_SECRET = (process.env.FLW_WEBHOOK_SECRET || '').trim();

// 🟢 Buyer initiates a new delivery payment
router.post('/order/:orderId', verifyBuyer, payOrderDelivery);
router.post('/confirm-payment', confirmPayment);

// ========================
// Flutterwave Webhook Route
// ========================
router.post(
  '/flutterwave-webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      console.log('🌀 Flutterwave webhook received');

      const signature = (req.headers['verif-hash'] || req.headers['verif_hash'] || '').trim();

      if (!req.body || !Buffer.isBuffer(req.body)) {
        console.error('❌ Raw body missing or invalid');
        return res.status(400).send('Invalid request body');
      }

      const payload = req.body.toString('utf8');

      if (!signature) {
        console.warn('❌ No signature provided');
        return res.status(401).send('No signature');
      }

      if (!FLW_WEBHOOK_SECRET) {
        console.error('❌ FLW_WEBHOOK_SECRET is missing');
        return res.status(500).send('Server configuration error');
      }

      if (signature !== FLW_WEBHOOK_SECRET) {
        console.warn('❌ Invalid signature', signature, FLW_WEBHOOK_SECRET);
        return res.status(401).send('Invalid signature');
      }

      console.log('✅ Webhook signature verified');

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

      const eventType = (event || '').trim().toLowerCase();

      const txRef = data.tx_ref || null;
      const flwRef = data.flw_ref || null;
      const paymentReference =
        body.meta_data?.payment_reference ||
        data.meta_data?.payment_reference ||
        data.meta?.payment_reference ||
        null;
      const flutterStatus = (data.status || '').trim().toLowerCase();

      console.log('💡 Parsed payload summary:', {
        event: eventType,
        tx_ref: txRef,
        flw_ref: flwRef,
        status: flutterStatus,
        amount: data.amount,
        payment_reference: paymentReference
      });

      console.log('🔑 Identifiers:', {
        txRef,
        flwRef,
        paymentReference,
        flutterStatus,
        eventType
      });

      if (!txRef && !paymentReference && !flwRef) {
        console.warn('⚠️ No usable payment identifiers found in webhook');
        return res.status(200).send('Ignored');
      }

      let newPaymentStatus = 'pending';

      if (
        ['charge.completed', 'payment.completed'].includes(eventType) &&
        ['successful', 'success', 'completed'].includes(flutterStatus)
      ) {
        newPaymentStatus = 'completed';
      } else if (['failed', 'cancelled'].includes(flutterStatus)) {
        newPaymentStatus = 'cancelled';
      }

      console.log('💠 Mapped newPaymentStatus:', newPaymentStatus);

      // Find the payment safely without the Postgres type error
      let payment;

      if (paymentReference) {
        [payment] = await sql`
          SELECT *
          FROM payments
          WHERE payment_reference = ${paymentReference}
          LIMIT 1;
        `;
      }

      if (!payment && txRef) {
        [payment] = await sql`
          SELECT *
          FROM payments
          WHERE tx_ref = ${txRef}
          LIMIT 1;
        `;
      }

      if (!payment && flwRef) {
        [payment] = await sql`
          SELECT *
          FROM payments
          WHERE flw_ref = ${flwRef}
          LIMIT 1;
        `;
      }

      if (!payment) {
        console.warn('⚠️ Payment not found', { txRef, flwRef, paymentReference });
        return res.status(200).send('Ignored');
      }

      // Idempotency check
      if (['completed', 'cancelled'].includes(payment.status)) {
        console.log(`ℹ️ Payment already finalized: ${payment.id}`);
        return res.status(200).send('Already processed');
      }

      const [updatedPayment] = await sql`
        UPDATE payments
        SET
          status = ${newPaymentStatus},
          flw_ref = ${flwRef ?? payment.flw_ref},
          amount = ${data.amount ?? payment.amount},
          currency = ${data.currency ?? payment.currency},
          updated_at = NOW()
        WHERE id = ${payment.id}
        RETURNING *;
      `;

      console.log('✅ Updated payment:', updatedPayment);

      // Handle delivery payment success
      if (payment.payment_type === 'delivery_fee' && newPaymentStatus === 'completed') {
        const orderId = payment.order_id;

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

        try {
          await finalizeDeliveryAfterPaymentAuto(orderId);
          console.log('🤝 Courier auto-assigned');
        } catch (err) {
          console.error('❌ Courier auto-assignment failed:', err);
        }

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