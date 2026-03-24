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

      // Signature verification
      const signature = (req.headers['verif-hash'] || req.headers['verif_hash'] || '').trim();
      if (signature !== FLW_WEBHOOK_SECRET) {
        return res.status(401).send('Invalid signature');
      }

      console.log('✅ Signature verified');

      const body = JSON.parse(req.body.toString('utf8'));
      const data = body.data;
      if (!data || data.status !== 'successful') {
        return res.status(200).send('OK');
      }

      const txRef = data.tx_ref;
      const flwRef = data.id || data.flw_ref;
      console.log('🔑 txRef:', txRef);

      // 1️⃣ Update payment status (ALWAYS SAFE)
      const [updatedPayment] = await sql`
        UPDATE payments 
        SET status = 'completed', flw_ref = ${flwRef}, updated_at = NOW()
        WHERE tx_ref = ${txRef}
        RETURNING id, user_id, payment_type, tx_ref, items, delivery_address;
      `;

      if (!updatedPayment) {
        console.warn('⚠️ Payment not found');
        return res.status(200).send('OK');
      }

      console.log('✅ Payment completed:', updatedPayment.id);

      // 2️⃣ Extract potential order_id (SAFE - no DB write yet)
      let orderId = null;
      if (txRef?.startsWith('order-')) {
        const uuidMatch = txRef.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
        if (uuidMatch) {
          orderId = uuidMatch[0];
          console.log('🔍 Potential order_id:', orderId);
        }
      }

      // 3️⃣ CHECK ORDER EXISTS BEFORE ANY FK UPDATE (CRITICAL)
      if (orderId) {
        const [orderCheck] = await sql`SELECT id FROM orders WHERE id = ${orderId} LIMIT 1`;
        
        if (orderCheck) {
          // ✅ Order exists - SAFE to link
          await sql`
            UPDATE payments 
            SET order_id = ${orderId} 
            WHERE id = ${updatedPayment.id};
          `;
          
          await sql`
            UPDATE orders 
            SET 
              payment_reference = ${txRef},
              status = 'paid',
              updated_at = NOW()
            WHERE id = ${orderId};
          `;
          
          console.log('✅ ✅ Order linked:', orderId);
        } else {
          console.warn('⚠️ Order missing:', orderId, '- Payment standalone');
        }
      }

      // 4️⃣ Delivery (only if order exists)
      if (updatedPayment.payment_type === 'delivery_fee' && orderId) {
        const [orderCheck] = await sql`SELECT id FROM orders WHERE id = ${orderId}`;
        if (orderCheck) {
          await sql`
            UPDATE deliveries 
            SET status = 'en_route', updated_at = NOW()
            WHERE order_id = ${orderId} AND status = 'pending';
          `;
          finalizeDeliveryAfterPaymentAuto(orderId).catch(console.error);
        }
      }

      console.log('✅ WEBHOOK SUCCESS');
      return res.status(200).send('OK');

    } catch (err) {
      console.error('💥 Webhook error:', err.message);
      return res.status(500).send('Error');
    }
  }
);

module.exports = router;