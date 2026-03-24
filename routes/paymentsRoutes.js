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
      if (signature !== process.env.FLW_WEBHOOK_SECRET?.trim()) {
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

      // Update payment
      const [updatedPayment] = await sql`
        UPDATE payments 
        SET status = 'completed', flw_ref = ${flwRef}, updated_at = NOW()
        WHERE tx_ref = ${txRef}
        RETURNING id, user_id, payment_type, tx_ref, items, delivery_address, phone, name, email, amount;
      `;

      console.log('✅ Payment:', updatedPayment.id);

      let orderId = updatedPayment.order_id;

      // 🔍 Extract UUID if missing
      if (!orderId && txRef?.startsWith('order-')) {
        const uuidMatch = txRef.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
        if (uuidMatch) orderId = uuidMatch[0];
      }

      // 🚀 CREATE ORDER IF MISSING (Your old flow!)
      if (!orderId) {
        orderId = crypto.randomUUID();
        
        await sql`
          INSERT INTO orders (
            id, user_id, status, total_amount, payment_reference,
            delivery_address, phone_number, name, email, created_at
          ) VALUES (
            ${orderId}, ${updatedPayment.user_id}, 'paid', ${updatedPayment.amount}, ${txRef},
            ${updatedPayment.delivery_address}, ${updatedPayment.phone}, ${updatedPayment.name}, ${updatedPayment.email}, NOW()
          );
        `;
        
        console.log('✅ NEW ORDER created:', orderId);
      } else {
        // Update existing order
        await sql`
          UPDATE orders 
          SET payment_reference = ${txRef}, status = 'paid', updated_at = NOW()
          WHERE id = ${orderId};
        `;
        console.log('✅ Existing order updated:', orderId);
      }

      // Link payment to order
      await sql`
        UPDATE payments SET order_id = ${orderId} WHERE id = ${updatedPayment.id};
      `;

      // Delivery
      if (updatedPayment.payment_type === 'delivery_fee') {
        await sql`
          UPDATE deliveries SET status = 'en_route' WHERE order_id = ${orderId};
        `;
        finalizeDeliveryAfterPaymentAuto(orderId).catch(console.error);
      }

      console.log('✅ PERFECT - Order & Payment linked!');
      return res.status(200).send('OK');

    } catch (err) {
      console.error('💥 Error:', err);
      return res.status(500).send('Error');
    }
  }
);

module.exports = router;