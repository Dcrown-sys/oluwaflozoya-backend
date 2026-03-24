// routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { finalizeDeliveryAfterPaymentAuto } = require('../controllers/deliveryController');

const FLW_WEBHOOK_SECRET = process.env.FLW_WEBHOOK_SECRET?.trim();  // Webhook Secret Hash

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

      // ✅ FLUTTERWAVE WEBHOOK SIGNATURE = SIMPLE STRING COMPARISON
      const signature = (req.headers['verif-hash'] || req.headers['verif_hash'] || '').trim();
      
      if (!signature) {
        console.warn('❌ No signature');
        return res.status(401).send('No signature');
      }

      if (!FLW_WEBHOOK_SECRET) {
        console.error('❌ FLW_WEBHOOK_SECRET missing');
        return res.status(500).send('Config error');
      }

      if (signature !== FLW_WEBHOOK_SECRET) {
        console.warn('❌ Invalid signature', signature.substring(0, 8) + '...');
        return res.status(401).send('Invalid signature');
      }

      console.log('✅ Signature verified ✅');

      const body = JSON.parse(req.body.toString('utf8'));
      const { data } = body;
      if (!data) return res.status(400).send('No data');

      const txRef = data.tx_ref;
      const flwRef = data.id || data.flw_ref;
      const flutterStatus = (data.status || '').toLowerCase();

      console.log('🔑 Processing:', txRef, flutterStatus);

      // Update payment
      const [updatedPayment] = await sql`
        UPDATE payments 
        SET 
          status = ${flutterStatus === 'successful' ? 'completed' : 'cancelled'},
          flw_ref = ${flwRef},
          updated_at = NOW()
        WHERE tx_ref = ${txRef}
        RETURNING id, order_id, payment_type, tx_ref;
      `;

      if (!updatedPayment) {
        console.warn('⚠️ No payment:', txRef);
        return res.status(200).send('OK');
      }

      console.log('✅ Payment updated:', updatedPayment.id);

      // 🔥 AUTO-FIX order_id NULL from tx_ref
      let orderId = updatedPayment.order_id;
      if (!orderId && txRef?.startsWith('order-')) {
        const parts = txRef.split('-');
        if (parts.length >= 3 && parts[2].match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i)) {
          orderId = parts[2];
          
          await sql`
            UPDATE payments SET order_id = ${orderId} 
            WHERE id = ${updatedPayment.id};
          `;
          console.log('🔗 FIXED order_id:', orderId);
        }
      }

      // 📦 UPDATE ORDERS.payment_reference (ALL types)
      if (orderId && flutterStatus === 'successful') {
        await sql`
          UPDATE orders 
          SET 
            payment_reference = ${txRef},
            status = CASE 
              WHEN ${updatedPayment.payment_type} = 'delivery_fee' THEN 'delivery_paid'
              ELSE 'paid'
            END,
            updated_at = NOW()
          WHERE id = ${orderId};
        `;
        console.log('✅ ORDER payment_reference:', txRef);

        // Delivery specific
        if (updatedPayment.payment_type === 'delivery_fee') {
          await sql`
            UPDATE deliveries 
            SET status = 'en_route', updated_at = NOW()
            WHERE order_id = ${orderId} AND status = 'pending';
          `;
          finalizeDeliveryAfterPaymentAuto(orderId).catch(console.error);
        }
      }

      console.log('✅ COMPLETE');
      return res.status(200).send('OK');

    } catch (err) {
      console.error('💥 Error:', err);
      return res.status(500).send('Error');
    }
  }
);

module.exports = router;