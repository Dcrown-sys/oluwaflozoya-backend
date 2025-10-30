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

// ✅ Main webhook route
router.post(
  '/flutterwave-webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      // 1️⃣ Verify Flutterwave signature
      const signature = req.headers['verif-hash'] || req.headers['verif_hash'];
      if (!signature || signature !== FLW_SECRET_HASH) {
        console.warn('⚠️ Invalid Flutterwave webhook signature');
        return res.status(401).send('Invalid signature');
      }

      // 2️⃣ Parse payload
      const payload = JSON.parse(req.body.toString());
      const { event, data } = payload;
      if (!event || !data || !data.tx_ref) {
        console.warn('⚠️ Invalid payload received:', payload);
        return res.status(400).send('Invalid payload');
      }

      const txRef = data.tx_ref;
      const fwStatus = (data.status || '').toLowerCase();
      console.log(`💳 Received Flutterwave webhook for tx_ref: ${txRef}, status: ${fwStatus}`);

      // 3️⃣ Determine payment status
      let paymentStatus = 'pending';
      if (['successful', 'completed'].includes(fwStatus)) paymentStatus = 'completed';
      else if (['failed', 'cancelled'].includes(fwStatus)) paymentStatus = 'cancelled';

      // 4️⃣ Update payments (check both tx_ref & payment_reference)
      const updatedPayments = await sql`
        UPDATE payments
        SET 
          status = ${paymentStatus},
          amount = ${data.amount || 0},
          currency = ${data.currency || 'NGN'},
          updated_at = NOW()
        WHERE tx_ref = ${txRef} OR payment_reference = ${txRef}
        RETURNING id, user_id, order_id, payment_reference, tx_ref, payment_type;
      `;

      if (!updatedPayments || updatedPayments.length === 0) {
        console.warn(`⚠️ Payment with tx_ref or reference ${txRef} not found`);
        return res.status(404).send('Payment not found');
      }

      const payment = updatedPayments[0];
      const { user_id: userId, order_id: orderId, payment_type: paymentType } = payment;

      // 5️⃣ Update order status based on payment type
      let orderStatus = 'pending';
      if (paymentType === 'order') {
        if (paymentStatus === 'completed') orderStatus = 'paid';
        else if (paymentStatus === 'cancelled') orderStatus = 'cancelled';
      } else if (['delivery', 'delivery_fee'].includes(paymentType)) {
        if (paymentStatus === 'completed') orderStatus = 'delivery_paid';
        else if (paymentStatus === 'cancelled') orderStatus = 'cancelled';
      }

      // 6️⃣ Update order record
      if (orderId) {
        await sql`
          UPDATE orders
          SET status = ${orderStatus}, updated_at = NOW()
          WHERE id = ${orderId};
        `;
        console.log(`🧾 Order ${orderId} status updated to ${orderStatus}`);
      }

      // 7️⃣ Auto-assign courier if delivery fee is completed
      if (['delivery', 'delivery_fee'].includes(paymentType) && paymentStatus === 'completed') {
        console.log(`🚚 Delivery fee confirmed for order ${orderId}, finalizing courier assignment...`);
        await finalizeDeliveryAfterPaymentAuto(orderId);
      }

      // 8️⃣ Notify user (via socket + notification table)
      if (userId && ioInstance) {
        let message = '';
        if (paymentType === 'order') {
          if (paymentStatus === 'completed')
            message = `🎉 Your order payment (ref: ${txRef}) was successful!`;
          else if (paymentStatus === 'cancelled')
            message = `⚠️ Your order payment (ref: ${txRef}) was cancelled.`;
          else message = `ℹ️ Your order payment (ref: ${txRef}) is ${paymentStatus}.`;
        } else if (['delivery', 'delivery_fee'].includes(paymentType)) {
          if (paymentStatus === 'completed')
            message = `🚚 Delivery fee (ref: ${txRef}) paid successfully! Courier assignment in progress.`;
          else if (paymentStatus === 'cancelled')
            message = `⚠️ Delivery payment (ref: ${txRef}) was cancelled.`;
          else message = `ℹ️ Your delivery payment (ref: ${txRef}) is ${paymentStatus}.`;
        }

        await createNotification(userId, message);
        console.log(`🔔 Notification sent to user ${userId}: ${message}`);
      }

      res.status(200).send('Webhook processed successfully');
    } catch (error) {
      console.error('❌ Error processing Flutterwave webhook:', error);
      res.status(500).send('Server error');
    }
  }
);

// 🔔 Helper: create notification
async function createNotification(userId, message) {
  try {
    const inserted = await sql`
      INSERT INTO notifications (user_id, title, body, read, created_at)
      VALUES (${userId}, 'Payment Update', ${message}, false, NOW())
      RETURNING id, user_id, title, body, read, created_at;
    `;
    const notification = inserted[0];
    if (ioInstance && notification) {
      ioInstance.to(`user_${userId}`).emit('newNotification', notification);
    }
  } catch (err) {
    console.error('❌ Failed to create notification:', err);
  }
}

module.exports = router;
