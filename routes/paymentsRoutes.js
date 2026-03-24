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

// ========================
// 🟢 PERFECT FLUTTERWAVE WEBHOOK
// ========================
router.post(
  '/flutterwave-webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      console.log('🌀 Flutterwave webhook received');

      // ✅ Signature: Simple string comparison
      const signature = (req.headers['verif-hash'] || req.headers['verif_hash'] || '').trim();
      if (signature !== FLW_WEBHOOK_SECRET) {
        console.warn('❌ Invalid signature');
        return res.status(401).send('Invalid signature');
      }

      console.log('✅ Signature verified');

      // Parse payload
      const body = JSON.parse(req.body.toString('utf8'));
      const data = body.data;
      if (!data || data.status !== 'successful') {
        return res.status(200).send('OK');
      }

      const txRef = data.tx_ref;
      const flwRef = data.id || data.flw_ref;
      console.log('🔑 txRef:', txRef);

      // Update payment status
      const [updatedPayment] = await sql`
        UPDATE payments 
        SET 
          status = 'completed',
          flw_ref = ${flwRef},
          updated_at = NOW()
        WHERE tx_ref = ${txRef}
        RETURNING id, order_id, payment_type, tx_ref;
      `;

      if (!updatedPayment) {
        console.warn('⚠️ Payment not found:', txRef);
        return res.status(200).send('OK');
      }

      console.log('✅ Payment updated:', updatedPayment.id);

      // 🔥 UNIVERSAL UUID EXTRACTION (handles ALL tx_ref formats)
      let orderId = updatedPayment.order_id;
      if (!orderId && txRef?.includes('-')) {
        console.log('🔍 Extracting UUID from:', txRef);
        
        // Finds UUID anywhere: order-123-19264254-f67b-445c-ba5f-4fea56548a0d
        const uuidMatch = txRef.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
        
        if (uuidMatch) {
          orderId = uuidMatch[0];
          
          await sql`
            UPDATE payments 
            SET order_id = ${orderId} 
            WHERE id = ${updatedPayment.id};
          `;
          console.log('🔗 ✅ FIXED order_id:', orderId);
        } else {
          console.warn('❌ No UUID found in txRef');
        }
      }

      // 📦 UPDATE ORDERS TABLE (makes order VISIBLE)
      if (orderId) {
        const [order] = await sql`
          UPDATE orders 
          SET 
            payment_reference = ${txRef},
            status = 'paid',  -- ← KEY: Makes visible in orders query
            updated_at = NOW()
          WHERE id = ${orderId}
          RETURNING id, status, payment_reference;
        `;
        
        console.log('✅ ORDER VISIBLE:', order?.id, order?.payment_reference);

        // Delivery fee specific
        if (updatedPayment.payment_type === 'delivery_fee') {
          await sql`
            UPDATE deliveries 
            SET status = 'en_route', updated_at = NOW()
            WHERE order_id = ${orderId} AND status = 'pending';
          `;
          
          try {
            await finalizeDeliveryAfterPaymentAuto(orderId);
            console.log('🤝 Courier assigned');
          } catch (err) {
            console.error('❌ Courier error:', err.message);
          }
        }
      } else {
        console.error('❌ NO ORDER_ID - Manual fix needed for:', txRef);
      }

      console.log('✅ WEBHOOK COMPLETE');
      return res.status(200).send('OK');

    } catch (err) {
      console.error('💥 Webhook error:', err);
      return res.status(500).send('Error');
    }
  }
);

module.exports = router;