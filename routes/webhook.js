// routes/paymentWebhook.js
const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { finalizeDeliveryAfterPaymentAuto } = require('../controllers/deliveryController');

const FLW_SECRET_HASH = process.env.FLW_SECRET_HASH || 'zoyaWebhookSecret123';

let ioInstance;
function setSocketIO(io) {
  ioInstance = io;
}
exports.setSocketIO = setSocketIO;

// ✅ Webhook handler
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    console.log('⚡ Incoming Flutterwave Webhook');

    // 1️⃣ Verify signature
    const signature = req.headers['verif-hash'] || req.headers['verif_hash'];
    if (!signature || signature !== FLW_SECRET_HASH) {
      console.warn('❌ Invalid signature');
      return res.status(401).send('Invalid signature');
    }

    // 2️⃣ Parse payload
    let payload;
    try {
      payload = JSON.parse(req.body.toString());
    } catch (err) {
      console.error('💥 Invalid JSON payload:', err);
      return res.status(400).send('Invalid JSON payload');
    }

    const { event, data } = payload;
    if (event !== 'charge.completed' || !data) {
      return res.status(200).send('Ignored non-charge event');
    }

    const txRef = data.tx_ref;
    const fwStatus = (data.status || '').toLowerCase();
    const paymentStatus = ['successful', 'completed'].includes(fwStatus) ? 'completed'
                       : ['failed', 'cancelled'].includes(fwStatus) ? 'cancelled'
                       : 'pending';

    // Extract order_id from meta or tx_ref
    let orderId = data.meta?.order_id;
    if (!orderId) {
      const match = txRef?.match(/DELIVERY-([0-9a-fA-F-]{36})/);
      if (match) orderId = match[1];
    }

    if (!orderId) {
      console.warn('⚠️ Could not determine order_id');
      return res.status(400).send('Missing order_id');
    }

    try {
      // 3️⃣ Fetch payment row
      const [payment] = await sql`
        SELECT * FROM payments WHERE tx_ref = ${txRef} LIMIT 1
      `;
      if (!payment) return res.status(404).send('Payment not found');

      // 4️⃣ Idempotency check
      if (payment.status === 'completed') {
        console.log('Payment already completed, skipping side effects');
        return res.status(200).send('Webhook already processed');
      }

      // 5️⃣ Update payment
      await sql`
        UPDATE payments
        SET status = ${paymentStatus},
            amount = ${data.amount || 0},
            currency = ${data.currency || 'NGN'},
            flw_ref = ${data.id},
            updated_at = NOW()
        WHERE id = ${payment.id};
      `;

      // 6️⃣ Update order status
      let orderStatus = 'pending';
      if (['delivery', 'delivery_fee'].includes(payment.payment_type) && paymentStatus === 'completed') {
        orderStatus = 'en_route';
      }
      await sql`
        UPDATE orders
        SET status = ${orderStatus}, updated_at = NOW()
        WHERE id = ${orderId};
      `;

      // 7️⃣ Auto-assign courier
      if (['delivery', 'delivery_fee'].includes(payment.payment_type) && paymentStatus === 'completed') {
        const result = await finalizeDeliveryAfterPaymentAuto(orderId);
        console.log('✅ finalizeDeliveryAfterPaymentAuto result:', result);

        // Update delivery status
        await sql`
          UPDATE deliveries
          SET status = 'en_route', updated_at = NOW()
          WHERE order_id = ${orderId};
        `;
      }

      // 8️⃣ Notify user via Socket.IO
      if (ioInstance) {
        const message =
          paymentStatus === 'completed'
            ? `🚚 Delivery fee paid successfully! Courier assigned.`
            : paymentStatus === 'cancelled'
            ? `⚠️ Delivery payment was cancelled.`
            : `ℹ️ Delivery payment status: ${paymentStatus}.`;

        const inserted = await sql`
          INSERT INTO notifications (user_id, title, body, read, created_at)
          VALUES (${payment.user_id}, 'Payment Update', ${message}, false, NOW())
          RETURNING id, user_id, title, body, read, created_at;
        `;
        if (inserted.length) ioInstance.to(`user_${payment.user_id}`).emit('newNotification', inserted[0]);
      }

      console.log('✅ Webhook processed successfully for tx_ref:', txRef);
      return res.status(200).send('Webhook processed successfully');
    } catch (err) {
      console.error('💥 Webhook processing error:', err);
      return res.status(500).send('Internal server error');
    }
  }
);

module.exports = router;
