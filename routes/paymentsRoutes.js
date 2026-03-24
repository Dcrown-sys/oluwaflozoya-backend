// routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const crypto = require('crypto');
const { finalizeDeliveryAfterPaymentAuto } = require('../controllers/deliveryController');

const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;

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

      const signature = req.headers['verif-hash'] || req.headers['verif_hash'];
      if (!signature) return res.status(401).send('No signature');

      const payload = req.body.toString();
      const hash = crypto.createHmac('sha256', FLW_SECRET_KEY)
                         .update(payload)
                         .digest('hex');

      if (signature !== hash) {
        console.warn('❌ Invalid signature');
        return res.status(401).send('Invalid signature');
      }

      console.log('✅ Signature verified');

      const body = JSON.parse(payload);
      const { data } = body;
      const txRef = data.tx_ref;
      const flwRef = data.id || data.flw_ref;
      const flutterStatus = (data.status || '').toLowerCase();

      // Update payment
      const [updatedPayment] = await sql`
        UPDATE payments SET
          status = ${flutterStatus === 'successful' ? 'completed' : 'cancelled'},
          flw_ref = ${flwRef},
          updated_at = NOW()
        WHERE tx_ref = ${txRef}
        RETURNING id, order_id, payment_type, tx_ref, status;
      `;

      if (!updatedPayment) {
        console.warn('⚠️ Payment not found:', txRef);
        return res.status(200).send('OK');
      }

      console.log('✅ Updated payment:', {
        id: updatedPayment.id,
        order_id: updatedPayment.order_id,
        payment_type: updatedPayment.payment_type
      });

      // 🔥 EXTRACT order_id FROM tx_ref if null
      let orderId = updatedPayment.order_id;
      if (!orderId && txRef && txRef.startsWith('order-')) {
        const uuidMatch = txRef.match(/order-[0-9]+-([a-f0-9-]{36})/);
        if (uuidMatch) {
          orderId = uuidMatch[1];
          await sql`UPDATE payments SET order_id = ${orderId} WHERE id = ${updatedPayment.id}`;
          console.log('🔗 FIXED order_id:', orderId);
        }
      }

      // 📦 UPDATE ORDER (all payment types)
      if (orderId && flutterStatus === 'successful') {
        await sql`
          UPDATE orders SET
            payment_reference = ${txRef},
            status = CASE 
              WHEN ${updatedPayment.payment_type} = 'delivery_fee' THEN 'delivery_paid'
              ELSE 'paid'
            END,
            updated_at = NOW()
          WHERE id = ${orderId};
        `;
        console.log('✅ ORDER updated:', orderId, txRef);

        // Delivery specific
        if (updatedPayment.payment_type === 'delivery_fee') {
          await sql`
            UPDATE deliveries SET status = 'en_route', updated_at = NOW()
            WHERE order_id = ${orderId} AND status = 'pending';
          `;
          finalizeDeliveryAfterPaymentAuto(orderId).catch(console.error);
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