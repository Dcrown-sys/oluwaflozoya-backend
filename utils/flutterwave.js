const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const axios = require('axios');

const FLW_SECRET_HASH = process.env.FLW_SECRET_HASH || 'zoyaWebhookSecret123';
const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY || 'FLWSECK-0b62e2fdee10788400a7d23a93cfb26d-19a076840e3vt-X';

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

    // 3️⃣ Normalize status
    const fwStatus = (data.status || '').toLowerCase();
    let paymentStatus = 'pending';
    if (['successful', 'completed'].includes(fwStatus)) paymentStatus = 'completed';
    else if (['failed', 'cancelled'].includes(fwStatus)) paymentStatus = 'cancelled';
    else if (fwStatus === 'pending') paymentStatus = 'pending';

    // 4️⃣ Find matching payment in DB
    const payments = await sql`
      SELECT * FROM payments 
      WHERE tx_ref = ${txRef} OR payment_reference = ${txRef}
      LIMIT 1
    `;
    if (!payments || payments.length === 0) {
      console.warn(`⚠️ Payment with tx_ref ${txRef} not found`);
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

    // 6️⃣ Handle order vs delivery payments
    const isDeliveryPayment = payment.payment_type === 'delivery';

    if (!isDeliveryPayment) {
      // 🛍 Normal order payment
      const orderStatus = paymentStatus === 'completed' ? 'paid' : paymentStatus;
      await sql`
        UPDATE orders
        SET status = ${orderStatus}, updated_at = NOW()
        WHERE id = ${payment.order_id}
      `;
    } else {
      // 🚚 Delivery payment
      const deliveryStatus = paymentStatus === 'completed' ? 'delivery_paid' : paymentStatus;
      await sql`
        UPDATE orders
        SET status = ${deliveryStatus}, updated_at = NOW()
        WHERE id = ${payment.order_id}
      `;

      if (paymentStatus === 'completed') {
        console.log('✅ Delivery fee payment completed — assigning courier...');

        // 7️⃣ Find delivery record tied to the order
        const deliveries = await sql`
          SELECT * FROM deliveries WHERE order_id = ${payment.order_id} LIMIT 1
        `;
        if (deliveries.length > 0) {
          const delivery = deliveries[0];
          if (delivery.courier_id) {
            // Assign courier officially
            await sql`
              UPDATE deliveries
              SET status = 'assigned', updated_at = NOW()
              WHERE id = ${delivery.id}
            `;
            await sql`
              UPDATE couriers
              SET is_assigned = true, updated_at = NOW()
              WHERE id = ${delivery.courier_id}
            `;
            console.log(`🚀 Courier ${delivery.courier_id} assigned to order ${payment.order_id}`);
          } else {
            console.warn(`⚠️ No courier found for delivery order ${payment.order_id}`);
          }
        } else {
          console.warn(`⚠️ No delivery record found for order ${payment.order_id}`);
        }
      }
    }

    // 8️⃣ Notify user
    if (payment.user_id && ioInstance) {
      let message = '';
      if (paymentStatus === 'completed') {
        message = isDeliveryPayment
          ? `🎉 Your delivery payment (ref: ${txRef}) was successful! The courier is now assigned.`
          : `🎉 Your order payment (ref: ${txRef}) was successful! We're processing your order.`;
      } else if (paymentStatus === 'cancelled') {
        message = `⚠️ Your payment (ref: ${txRef}) was cancelled.`;
      } else {
        message = `ℹ️ Your payment (ref: ${txRef}) is pending.`;
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

// Helper: Notification creator
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
  try {
    const resp = await axios.post(
      'https://api.flutterwave.com/v3/payments',
      payload,
      {
        headers: {
          Authorization: `Bearer ${FLW_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
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
