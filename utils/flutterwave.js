const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const axios = require('axios');


const FLW_SECRET_HASH = process.env.FLW_SECRET_HASH || 'zoyaWebhookSecret123';
const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY || 'FLWSECK-0b62e2fdee10788400a7d23a93cfb26d-19a076840e3vt-X';

// Socket.IO instance (to emit notifications)
let ioInstance;
function setSocketIO(io) {
  ioInstance = io;
}
exports.setSocketIO = setSocketIO;

router.post('/flutterwave-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    // 1️⃣ Verify Flutterwave signature
    const signature = req.headers['verif-hash'] || req.headers['verif_hash'];
    if (!signature || signature !== FLW_SECRET_HASH) {
      console.warn('⚠️ Invalid Flutterwave webhook signature');
      return res.status(401).send('Invalid signature');
    }

    // 2️⃣ Parse payload
    const payload = JSON.parse(req.body.toString());
    console.log('✅ Flutterwave webhook received:', JSON.stringify(payload, null, 2));

    const { event, data } = payload;
    if (!event || !data) return res.status(400).send('Invalid payload');

    const txRef = data.tx_ref;
    if (!txRef) return res.status(400).send('Missing tx_ref');

    // 3️⃣ Map Flutterwave statuses
    const fwStatus = (data.status || '').toLowerCase();
    let paymentStatus = 'pending';
    if (['successful', 'completed'].includes(fwStatus)) paymentStatus = 'completed';
    else if (['failed', 'cancelled'].includes(fwStatus)) paymentStatus = 'cancelled';
    else if (fwStatus === 'pending') paymentStatus = 'pending';

    // 4️⃣ Fetch payment from DB
    const payments = await sql`
      SELECT * FROM payments WHERE tx_ref = ${txRef} OR payment_reference = ${txRef}
    `;
    if (!payments || payments.length === 0) {
      console.warn(`⚠️ Payment not found for tx_ref: ${txRef}`);
      return res.status(404).send('Payment not found');
    }

    const payment = payments[0];

    // 5️⃣ Update payment record
    await sql`
      UPDATE payments
      SET status = ${paymentStatus},
          amount = ${data.amount},
          currency = ${data.currency},
          verified = ${paymentStatus === 'completed'},
          updated_at = NOW()
      WHERE id = ${payment.id}
    `;

    // 6️⃣ Determine order or delivery payment
    const isDeliveryPayment = payment.payment_type === 'delivery';

    // 7️⃣ Update order statuses accordingly
    if (!isDeliveryPayment) {
      // order payment
      const orderStatus = paymentStatus === 'completed' ? 'paid' : paymentStatus;
      await sql`
        UPDATE orders
        SET status = ${orderStatus}, updated_at = NOW()
        WHERE id = ${payment.order_id}
      `;
    } else {
      // delivery payment
      const deliveryStatus = paymentStatus === 'completed' ? 'delivery_paid' : paymentStatus;
      await sql`
        UPDATE orders
        SET status = ${deliveryStatus}, updated_at = NOW()
        WHERE id = ${payment.order_id}
      `;
    }

    // 8️⃣ Notify user
    if (payment.user_id && ioInstance) {
      let message = '';
      if (paymentStatus === 'completed') {
        message = isDeliveryPayment
          ? `🎉 Your delivery payment (ref: ${txRef}) was successful! The courier will proceed.`
          : `🎉 Your order payment (ref: ${txRef}) was successful! Proceeding to order processing.`;
      } else if (paymentStatus === 'cancelled') {
        message = `⚠️ Your payment (ref: ${txRef}) was cancelled. No action was taken.`;
      } else {
        message = `ℹ️ Your payment (ref: ${txRef}) is pending. Please complete to proceed.`;
      }
      await createNotification(payment.user_id, message);
      console.log(`🔔 Notification sent to user ${payment.user_id}: ${message}`);
    }

    res.status(200).send('Webhook processed successfully');
  } catch (err) {
    console.error('❌ Error processing Flutterwave webhook:', err);
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

async function createPaymentLink(payload) {
  // This function calls Flutterwave to create a payment (link/checkout)
  // Keep payload structure flexible (cart endpoint already uses similar).
  try {
    const resp = await axios.post(
      'https://api.flutterwave.com/v3/payments', // works for inline payments; if you use Payment Links endpoint, replace URL accordingly
      payload,
      {
        headers: {
          Authorization: `Bearer ${FLW_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    // Flutterwave responses differ by endpoint. Try common locations for link:
    // - resp.data.data.link  (used by some endpoints)
    // - resp.data.link       (occasionally)
    // return the whole resp.data so controllers can inspect.
    return resp.data;
  } catch (err) {
    console.error('❌ Flutterwave API error:', err.response?.data || err.message);
    throw err;
  }
}


module.exports = {
  router,
  setSocketIO,
  createPaymentLink,
};

