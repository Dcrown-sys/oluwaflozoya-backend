const express = require('express');
const router = express.Router();
const { sql } = require('../db');

const FLW_SECRET_HASH = process.env.FLW_SECRET_HASH || 'zoyaWebhookSecret123';

let ioInstance;
function setSocketIO(io) { ioInstance = io; }
exports.setSocketIO = setSocketIO;

router.post('/flutterwave-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    // 1️⃣ Verify signature
    const signature = req.headers['verif-hash'] || req.headers['verif_hash'];
    if (!signature || signature !== FLW_SECRET_HASH) {
      console.warn('⚠️ Invalid Flutterwave webhook signature');
      return res.status(401).send('Invalid signature');
    }

    // 2️⃣ Parse payload
    const payload = JSON.parse(req.body.toString());
    const { event, data } = payload;
    if (!event || !data || !data.tx_ref) return res.status(400).send('Invalid payload');

    const txRef = data.tx_ref;
    const fwStatus = (data.status || '').toLowerCase();
    let paymentStatus = 'pending';
    if (['successful', 'completed'].includes(fwStatus)) paymentStatus = 'completed';
    else if (['failed', 'cancelled'].includes(fwStatus)) paymentStatus = 'cancelled';
    else if (fwStatus === 'pending') paymentStatus = 'pending';

    // 3️⃣ Update payments table
    const updatedPayments = await sql`
      UPDATE payments
      SET status = ${paymentStatus}, amount = ${data.amount}, currency = ${data.currency}, updated_at = NOW()
      WHERE tx_ref = ${txRef}
      RETURNING id, user_id, order_id, payment_reference, payment_type
    `;
    if (!updatedPayments || updatedPayments.length === 0) {
      console.warn(`⚠️ Payment not found for tx_ref: ${txRef}`);
      return res.status(404).send('Payment not found');
    }

    const payment = updatedPayments[0];
    const { user_id: userId, order_id: orderId, payment_reference: paymentReference, payment_type: paymentType } = payment;

    // 4️⃣ Update order based on payment type
    let orderStatus = 'pending';
    if (paymentType === 'order') {
      if (paymentStatus === 'completed') orderStatus = 'paid';
      else if (paymentStatus === 'cancelled') orderStatus = 'cancelled';
    } else if (paymentType === 'delivery') {
      if (paymentStatus === 'completed') orderStatus = 'delivery_paid';
      else if (paymentStatus === 'cancelled') orderStatus = 'cancelled';
      else if (paymentStatus === 'pending') orderStatus = 'delivery_pending';
    }

    if (orderId) {
      await sql`
        UPDATE orders
        SET status = ${orderStatus}, updated_at = NOW()
        WHERE id = ${orderId}
      `;
    }

    // 5️⃣ Notify user
    if (userId && ioInstance) {
      let message = '';
      if (paymentType === 'order') {
        if (paymentStatus === 'completed') message = `🎉 Your order payment (ref: ${txRef}) was successful!`;
        else if (paymentStatus === 'cancelled') message = `⚠️ Your order payment (ref: ${txRef}) was cancelled.`;
        else message = `ℹ️ Your order payment (ref: ${txRef}) is ${paymentStatus}.`;
      } else if (paymentType === 'delivery') {
        if (paymentStatus === 'completed') message = `🚚 Delivery fee (ref: ${txRef}) was paid successfully!`;
        else if (paymentStatus === 'cancelled') message = `⚠️ Delivery payment (ref: ${txRef}) was cancelled.`;
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
});

// Helper: create notification and emit via Socket.IO
async function createNotification(userId, message) {
  try {
    const inserted = await sql`
      INSERT INTO notifications (user_id, title, body, read, created_at)
      VALUES (${userId}, 'Payment Update', ${message}, false, NOW())
      RETURNING id, user_id, title, body, read, created_at
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
