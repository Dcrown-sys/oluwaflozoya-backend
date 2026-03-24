// routes/paymentRoutes.js - BULLETPROOF VERSION
const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { finalizeDeliveryAfterPaymentAuto } = require('../controllers/deliveryController');

const FLW_WEBHOOK_SECRET = process.env.FLW_WEBHOOK_SECRET?.trim();

const { payOrderDelivery, confirmPayment } = require('../controllers/paymentsController');
const { verifyBuyer } = require('../middleware/auth');

router.post('/order/:orderId', verifyBuyer, payOrderDelivery);
router.post('/confirm-payment', confirmPayment);

router.post(
  '/flutterwave-webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      console.log('🌀 Flutterwave webhook received');

      const signature = (req.headers['verif-hash'] || req.headers['verif_hash'] || '').trim();
      const payload = req.body.toString();

      if (!signature) {
        console.warn('❌ No signature provided');
        return res.status(401).send('No signature');
      }

      if (!FLW_WEBHOOK_SECRET) {
        console.error('❌ FLW_WEBHOOK_SECRET is missing');
        return res.status(500).send('Server configuration error');
      }

      if (signature !== FLW_WEBHOOK_SECRET) {
        console.warn('❌ Invalid signature', { received: signature });
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

      console.log('💡 Parsed payload:', JSON.stringify(body));

      const txRef = data.tx_ref || null;
      const flwRef = data.id || null;         // Flutterwave's transaction ID
      const flutterStatus = (data.status || '').toLowerCase();

      console.log('🔑 Identifiers:', { txRef, flwRef, flutterStatus });

      if (!txRef) {
        console.warn('⚠️ No tx_ref in payload, cannot process');
        return res.status(200).send('Ignored - no tx_ref');
      }

      // ✅ FIX 1: Only look up by tx_ref (not OR flw_ref which can be null)
      const [payment] = await sql`
        SELECT * FROM payments
        WHERE tx_ref = ${txRef}
        LIMIT 1;
      `;

      if (!payment) {
        console.warn('⚠️ Payment not found for tx_ref:', txRef);
        return res.status(200).send('Ignored - payment not found');
      }

      // Idempotency check
      if (['completed', 'cancelled'].includes(payment.status)) {
        console.log(`ℹ️ Payment already finalized: ${payment.id}`);
        return res.status(200).send('Already processed');
      }

      // Determine new status
      let newPaymentStatus = 'pending';
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

      // ✅ FIX 2: Always store flw_ref from data.id
      await sql`
        UPDATE payments
        SET 
          status = ${newPaymentStatus},
          flw_ref = ${flwRef},
          amount = ${data.amount || payment.amount},
          currency = ${data.currency || payment.currency},
          updated_at = NOW()
        WHERE id = ${payment.id};
      `;

      console.log('✅ Payment record updated');

      // Handle delivery payment completion
      if (payment.payment_type === 'delivery_fee' && newPaymentStatus === 'completed') {
        const orderId = payment.order_id;

        if (!orderId) {
          console.error('❌ No order_id on payment record:', payment.id);
          return res.status(200).send('OK - but missing order_id');
        }

        // ✅ FIX 3: Broader status match so delivery update doesn't silently skip
        const updatedDelivery = await sql`
          UPDATE deliveries
          SET status = 'en_route', updated_at = NOW()
          WHERE order_id = ${orderId}
            AND status NOT IN ('en_route', 'delivered', 'cancelled')
          RETURNING id;
        `;

        if (updatedDelivery.length === 0) {
          console.warn(`⚠️ No eligible delivery found for order ${orderId} — check delivery status`);
        } else {
          console.log('🚚 Delivery updated to en_route:', updatedDelivery);
        }

        // Auto-assign courier
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

      // Handle order payment (payment_type === 'order')
      if (payment.payment_type === 'order' && newPaymentStatus === 'completed') {
        // Add your order creation/confirmation logic here if needed
        console.log('🛒 Order payment completed for payment:', payment.id);
      }

      console.log(`✅ Webhook fully processed for payment ${payment.id}`);
      return res.status(200).send('OK');

    } catch (err) {
      console.error('💥 Webhook processing error:', err);
      return res.status(500).send('Server error');
    }
  }
);

module.exports = router;