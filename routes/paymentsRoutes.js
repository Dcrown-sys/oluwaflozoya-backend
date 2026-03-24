// routes/paymentRoutes.js
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
      if (signature !== FLW_WEBHOOK_SECRET) {
        return res.status(401).send('Invalid signature');
      }

      console.log('✅ Signature verified');

      const body = JSON.parse(req.body.toString('utf8'));
      const data = body.data;
      const txRef = data.tx_ref;
      const flwRef = data.id || data.flw_ref;
      const flutterStatus = (data.status || '').toLowerCase();

      // Update payment
      const [updatedPayment] = await sql`
        UPDATE payments SET
          status = 'completed',
          flw_ref = ${flwRef},
          updated_at = NOW()
        WHERE tx_ref = ${txRef}
        RETURNING id, order_id, payment_type, tx_ref;
      `;

      console.log('✅ Payment ID:', updatedPayment.id);

      // 🔥 UUID EXTRACTION
      let orderId = updatedPayment.order_id;
      if (!orderId && txRef?.startsWith('order-')) {
        console.log('🔍 txRef:', txRef);
        const parts = txRef.split('-');
        console.log('Parts:', parts.length, 'UUID:', parts[2]);
        
        const potentialUUID = parts[2];
        if (potentialUUID?.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i)) {
          orderId = potentialUUID;
          
          await sql`
            UPDATE payments SET order_id = ${orderId} WHERE id = ${updatedPayment.id};
          `;
          console.log('🔗 ✅ FIXED order_id:', orderId);
        } else {
          console.warn('❌ UUID failed:', potentialUUID);
        }
      }

      // 📦 UPDATE ORDER
      if (orderId) {
        const [order] = await sql`
          UPDATE orders SET
            payment_reference = ${txRef},
            status = 'paid',
            updated_at = NOW()
          WHERE id = ${orderId}
          RETURNING id, status, payment_reference;
        `;
        console.log('✅ ORDER:', order?.id, order?.payment_reference);

        // Delivery specific
        if (updatedPayment.payment_type === 'delivery_fee') {
          await sql`
            UPDATE deliveries 
            SET status = 'en_route', updated_at = NOW()
            WHERE order_id = ${orderId} AND status = 'pending';
          `;
          finalizeDeliveryAfterPaymentAuto(orderId).catch(console.error);
        }
      } else {
        console.error('❌ NO ORDER_ID - txRef:', txRef);
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