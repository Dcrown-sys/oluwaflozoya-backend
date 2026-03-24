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
        console.warn('❌ Invalid signature');
        return res.status(401).send('Invalid signature');
      }

      console.log('✅ Signature verified');

      const body = JSON.parse(payload);
      const { event, data } = body;

      if (!data) {
        return res.status(400).send('No data');
      }

      // 🔑 Extract identifiers
      const txRef = data.tx_ref;
      const flwRef = data.id || data.flw_ref;
      const paymentReference = 
        body.meta_data?.payment_reference || 
        data.meta_data?.payment_reference ||
        data.payment_reference ||
        data.meta?.payment_reference;

      const flutterStatus = (data.status || '').toLowerCase();
      console.log('🔑 Found:', { txRef, flwRef, paymentReference, status: flutterStatus });

      // 💠 Map status
      let newStatus = 'pending';
      if (
        ['charge.completed', 'payment.completed'].includes(event) &&
        ['successful', 'success'].includes(flutterStatus)
      ) {
        newStatus = 'completed';
      } else if (['failed', 'cancelled'].includes(flutterStatus)) {
        newStatus = 'cancelled';
      }

      // 🔍 Find payment record
      let payment;
      if (paymentReference) {
        [payment] = await sql`
          SELECT * FROM payments 
          WHERE payment_reference = ${paymentReference} LIMIT 1;
        `;
      }
      if (!payment && txRef) {
        [payment] = await sql`
          SELECT * FROM payments WHERE tx_ref = ${txRef} LIMIT 1;
        `;
      }
      if (!payment && flwRef) {
        [payment] = await sql`
          SELECT * FROM payments WHERE flw_ref = ${flwRef} LIMIT 1;
        `;
      }

      if (!payment) {
        console.warn('⚠️ No payment found');
        return res.status(200).send('OK');
      }

      // Skip if already processed
      if (['completed', 'cancelled'].includes(payment.status)) {
        return res.status(200).send('Already processed');
      }

      // 💾 Update PAYMENTS table
      const [updatedPayment] = await sql`
        UPDATE payments SET
          status = ${newStatus},
          flw_ref = ${flwRef || payment.flw_ref},
          updated_at = NOW()
        WHERE id = ${payment.id}
        RETURNING *;
      `;

      console.log('✅ Payment updated:', updatedPayment.id);

      // 🚚 Handle delivery fee payments
      if (payment.payment_type === 'delivery_fee' && newStatus === 'completed') {
        const orderId = payment.order_id;

        if (orderId) {
          // 1. Update delivery
          await sql`
            UPDATE deliveries
            SET status = 'en_route', updated_at = NOW()
            WHERE order_id = ${orderId} AND status = 'pending';
          `;

          // 🔑 2. UPDATE ORDERS table payment_reference & status
          const [updatedOrder] = await sql`
            UPDATE orders SET
              status = 'en_route',
              payment_reference = ${paymentReference || payment.payment_reference || txRef},
              updated_at = NOW()
            WHERE id = ${orderId}
            RETURNING id, status, payment_reference;
          `;

          console.log('✅ ORDER payment recorded:', {
            order_id: updatedOrder.id,
            payment_ref: updatedOrder.payment_reference,
            status: updatedOrder.status
          });

          // 3. Auto-assign courier
          try {
            await finalizeDeliveryAfterPaymentAuto(orderId);
            console.log('🤝 Courier assigned');
          } catch (err) {
            console.error('❌ Courier failed:', err.message);
          }
        }
      }

      return res.status(200).send('OK');
    } catch (err) {
      console.error('💥 Error:', err);
      return res.status(500).send('Error');
    }
  }
);

module.exports = router;