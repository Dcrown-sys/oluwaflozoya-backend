// routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { finalizeDeliveryAfterPaymentAuto } = require('../controllers/deliveryController');

const FLW_WEBHOOK_SECRET = (process.env.FLW_WEBHOOK_SECRET || '').trim();

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
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      console.log('🌀 Flutterwave webhook received');

      if (!req.body || !Buffer.isBuffer(req.body)) {
        return res.status(400).send('Invalid body');
      }

      const signature = (req.headers['verif-hash'] || req.headers['verif_hash'] || '').trim();
      const payload = req.body.toString('utf8');

      if (!signature || signature !== FLW_WEBHOOK_SECRET) {
        return res.status(401).send('Invalid signature');
      }

      const body = JSON.parse(payload);
      const { event, data } = body;

      const txRef = data.tx_ref;
      const flwRef = data.id || data.flw_ref;
      const flutterStatus = (data.status || '').toLowerCase();

      console.log('🔑 Webhook data:', { txRef, flwRef, status: flutterStatus });

      let newStatus = 'pending';
      if (['successful', 'success'].includes(flutterStatus)) {
        newStatus = 'completed';
      } else if (['failed', 'cancelled'].includes(flutterStatus)) {
        newStatus = 'cancelled';
      }

      // 🔍 Find payment FIRST by tx_ref
      let [payment] = await sql`
        SELECT * FROM payments WHERE tx_ref = ${txRef} LIMIT 1;
      `;

      if (!payment) {
        console.warn('❌ Payment not found for tx_ref:', txRef);
        return res.status(200).send('OK');
      }

      console.log('✅ Found payment:', payment.id, 'order_id:', payment.order_id);

      // Skip if done
      if (['completed', 'cancelled'].includes(payment.status)) {
        return res.status(200).send('Already processed');
      }

      // 💾 Update PAYMENTS table
      const [updatedPayment] = await sql`
        UPDATE payments SET
          status = ${newStatus},
          flw_ref = ${flwRef},
          updated_at = NOW()
        WHERE id = ${payment.id}
        RETURNING *;
      `;

      console.log('✅ Payment updated:', updatedPayment.id);

      // 🔥 ALWAYS UPDATE ORDER if order_id exists (for ALL payment types)
      if (updatedPayment.order_id && newStatus === 'completed') {
        const orderId = updatedPayment.order_id;

        console.log('🔗 Linking to order:', orderId);

        // 1. Update ORDER payment_reference & status
        const [updatedOrder] = await sql`
          UPDATE orders SET
            status = 'paid',  -- or 'en_route' if delivery
            payment_reference = ${txRef},  -- Use tx_ref as payment reference
            updated_at = NOW()
          WHERE id = ${orderId}
          RETURNING id, status, payment_reference;
        `;

        console.log('✅ ORDER UPDATED:', updatedOrder.id, updatedOrder.payment_reference);

        // 2. Update delivery if exists
        await sql`
          UPDATE deliveries
          SET status = 'en_route', updated_at = NOW()
          WHERE order_id = ${orderId} AND status = 'pending';
        `;

        // 3. Auto-assign courier for delivery fees
        if (updatedPayment.payment_type === 'delivery_fee') {
          try {
            await finalizeDeliveryAfterPaymentAuto(orderId);
            console.log('🤝 Courier assigned');
          } catch (err) {
            console.error('❌ Courier failed:', err);
          }
        }
      } else {
        console.warn('⚠️ No order_id for payment:', updatedPayment.id);
      }

      return res.status(200).send('OK');
    } catch (err) {
      console.error('💥 Error:', err);
      return res.status(500).send('Error');
    }
  }
);

module.exports = router;