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

// ✅ FULLY LOGGED FLUTTERWAVE WEBHOOK HANDLER
router.post(
  '/flutterwave-webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    console.log('\n===============================');
    console.log('⚡ Incoming Flutterwave Webhook');
    console.log('===============================');

    try {
      // 1️⃣ Verify signature
      const signature = req.headers['verif-hash'] || req.headers['verif_hash'];
      console.log('🔐 Received signature:', signature);

      if (!signature || signature !== FLW_SECRET_HASH) {
        console.warn('❌ Invalid Flutterwave webhook signature');
        return res.status(401).send('Invalid signature');
      }
      console.log('✅ Signature verified successfully');

      // 2️⃣ Parse raw payload
      let payload;
      try {
        payload = JSON.parse(req.body.toString());
      } catch (parseErr) {
        console.error('💥 Failed to parse webhook payload:', parseErr);
        return res.status(400).send('Invalid JSON payload');
      }

      console.log('🧾 Full Payload:', JSON.stringify(payload, null, 2));

      const { event, data } = payload;
      if (!event || !data) {
        console.warn('⚠️ Missing event or data in webhook payload');
        return res.status(400).send('Invalid payload structure');
      }

      const txRef = data.tx_ref;
      const fwStatus = (data.status || '').toLowerCase();
      console.log(`💳 tx_ref: ${txRef}, status: ${fwStatus}`);

      // 3️⃣ Extract order_id
      let orderId = data.meta?.order_id;
      if (!orderId || orderId.length < 20) {
        const match = txRef?.match(/DELIVERY-([0-9a-fA-F-]{36})/);
        if (match) {
          orderId = match[1];
          console.log(`⚙️ Extracted order_id from tx_ref: ${orderId}`);
        } else {
          console.warn('⚠️ Could not extract valid order_id');
        }
      }

      const paymentType = data.meta?.payment_type || 'order';
      console.log('💰 Payment type:', paymentType);

      // 4️⃣ Determine payment status
      let paymentStatus = 'pending';
      if (['successful', 'completed'].includes(fwStatus)) paymentStatus = 'completed';
      else if (['failed', 'cancelled'].includes(fwStatus)) paymentStatus = 'cancelled';
      console.log('📊 Derived payment status:', paymentStatus);

      // 5️⃣ Update payments table
      console.log('💾 Updating payments table...');
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

      console.log('📦 Payment update result:', updatedPayments);

      if (!updatedPayments || updatedPayments.length === 0) {
        console.warn(`⚠️ No payment found for tx_ref: ${txRef}`);
        return res.status(404).send('Payment not found');
      }

      const payment = updatedPayments[0];
      const { user_id: userId } = payment;
      const finalOrderId = orderId || payment.order_id;
      console.log('🔗 Final order_id:', finalOrderId, '| User ID:', userId);

      // 6️⃣ Compute new order status
      let orderStatus = 'pending';
if (paymentType === 'order') {
  if (paymentStatus === 'completed') orderStatus = 'en_route'; // ✅ Allowed
  else if (paymentStatus === 'cancelled') orderStatus = 'pending'; // fallback
} else if (['delivery', 'delivery_fee'].includes(paymentType)) {
  if (paymentStatus === 'completed') orderStatus = 'en_route'; // ✅ or 'delivered' if delivery complete
  else if (paymentStatus === 'cancelled') orderStatus = 'pending';
}

      // 7️⃣ Update orders table
      if (finalOrderId) {
        console.log('💾 Updating orders table...');
        await sql`
          UPDATE orders
          SET status = ${orderStatus}, updated_at = NOW()
          WHERE id = ${finalOrderId};
        `;
        console.log(`🧾 Order ${finalOrderId} status updated to ${orderStatus}`);
      } else {
        console.warn('⚠️ No valid order_id found to update');
      }

      // 8️⃣ Courier auto-assignment
      console.log('🧩 Checking courier assignment condition:', {
        paymentType,
        paymentStatus,
        finalOrderId,
      });

      try {
        if (['delivery', 'delivery_fee'].includes(paymentType) && paymentStatus === 'completed') {
          console.log(`🚚 Delivery fee confirmed for order ${finalOrderId}, starting auto-assignment...`);
          const assignResult = await finalizeDeliveryAfterPaymentAuto(finalOrderId);
          console.log('✅ finalizeDeliveryAfterPaymentAuto result:', assignResult);
        } else {
          console.log('⚠️ Condition not met for courier assignment — skipped.');
        }
      } catch (assignErr) {
        console.error('💥 Error during courier assignment:', assignErr);
      }

      // 9️⃣ Notify user via Socket.IO
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
            message = `🚚 Delivery fee (ref: ${txRef}) paid successfully! Courier assigned automatically.`;
          else if (paymentStatus === 'cancelled')
            message = `⚠️ Delivery payment (ref: ${txRef}) was cancelled.`;
          else message = `ℹ️ Your delivery payment (ref: ${txRef}) is ${paymentStatus}.`;
        }

        console.log('📨 Sending notification to user:', userId, '| Message:', message);
        await createNotification(userId, message);
        console.log(`🔔 Notification sent to user ${userId}`);
      } else {
        console.warn('⚠️ No SocketIO instance or user ID found — skipping notification emit.');
      }

      console.log('✅ Webhook fully processed.\n');
      return res.status(200).send('Webhook processed successfully');
    } catch (error) {
      console.error('❌ FATAL ERROR processing webhook:', error);
      return res.status(500).send('Server error');
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
