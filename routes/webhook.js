const express = require('express');
const router = express.Router();
const { sql } = require('../db');

const FLW_SECRET_HASH = process.env.FLW_SECRET_HASH || 'zoyaWebhookSecret123';

// Socket.IO instance (to emit notifications)
let ioInstance;
function setSocketIO(io) {
  ioInstance = io;
}
exports.setSocketIO = setSocketIO;

router.post('/flutterwave-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    // Verify signature header
    const signature = req.headers['verif-hash'] || req.headers['verif_hash'];
    if (!signature || signature !== FLW_SECRET_HASH) {
      console.warn('⚠️ Invalid Flutterwave webhook signature');
      return res.status(401).send('Invalid signature');
    }

    // Parse webhook JSON payload
    const payload = JSON.parse(req.body.toString());
    console.log('✅ Flutterwave webhook received:', JSON.stringify(payload, null, 2));

    const { event, data } = payload;

    if (!event || !data) {
      console.warn('❌ Invalid webhook payload - missing event or data');
      return res.status(400).send('Invalid payload');
    }

    const txRef = data.tx_ref;
    if (!txRef) {
      console.warn('❌ Missing tx_ref in payload data');
      return res.status(400).send('Missing tx_ref');
    }

    // Map Flutterwave payment statuses to your DB statuses
    // Flutterwave can send: successful, failed, cancelled, pending, etc.
    const fwStatus = (data.status || '').toLowerCase();
    let paymentStatus = 'pending'; // default

    if (['successful', 'completed'].includes(fwStatus)) {
      paymentStatus = 'completed';
    } else if (['failed', 'cancelled'].includes(fwStatus)) {
      paymentStatus = 'cancelled';
    } else if (fwStatus === 'pending') {
      paymentStatus = 'pending';
    } else {
      paymentStatus = fwStatus; // catch-all
    }

    // Update payments table with latest status & details
    const updatedPayments = await sql`
      UPDATE payments
      SET status = ${paymentStatus},
          amount = ${data.amount},
          currency = ${data.currency},
          updated_at = NOW()
      WHERE tx_ref = ${txRef}
      RETURNING user_id, payment_reference
    `;

    if (!updatedPayments || updatedPayments.length === 0) {
      console.warn(`⚠️ Payment not found for tx_ref: ${txRef}`);
      return res.status(404).send('Payment not found');
    }

    const payment = updatedPayments[0];
    const userId = payment.user_id;
    const paymentReference = payment.payment_reference;

    // Sync related order status accordingly
    let orderStatus = 'pending';
    if (paymentStatus === 'completed') orderStatus = 'paid';
    else if (paymentStatus === 'cancelled') orderStatus = 'cancelled';
    else if (paymentStatus === 'pending') orderStatus = 'pending';

    if (paymentReference) {
      await sql`
        UPDATE orders
        SET status = ${orderStatus}, updated_at = NOW()
        WHERE payment_reference = ${paymentReference}
      `;
    }

    // Create user notification & emit via socket
    if (userId && ioInstance) {
      let message = '';
      if (paymentStatus === 'completed') {
        message = `🎉 Your payment (ref: ${txRef}) was successful! Your order is being processed.`;
      } else if (paymentStatus === 'cancelled') {
        message = `⚠️ Your payment (ref: ${txRef}) was cancelled. No order was placed.`;
      } else if (paymentStatus === 'pending') {
        message = `ℹ️ Your payment (ref: ${txRef}) is pending. Please complete payment to proceed.`;
      } else {
        message = `ℹ️ Payment update: status is ${paymentStatus} for ref: ${txRef}.`;
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

// Helper: create notification and emit to user via Socket.IO
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
