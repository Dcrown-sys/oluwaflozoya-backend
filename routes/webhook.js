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

// ✅ FULLY FIXED FLUTTERWAVE WEBHOOK HANDLER
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    console.log('\n===============================');
    console.log('⚡ Incoming Flutterwave Webhook');
    console.log('===============================');
    

    const signature = req.headers['verif-hash'] || req.headers['verif_hash'];
    console.log('🔐 Received signature:', signature);

    if (!signature || signature !== FLW_SECRET_HASH) {
      console.warn('❌ Invalid Flutterwave webhook signature');
      return res.status(401).send('Invalid signature');
    }

    console.log('✅ Signature verified successfully');

    let payload;
    try {
      payload = JSON.parse(req.body.toString());
    } catch (err) {
      console.error('💥 Failed to parse payload:', err);
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

    // Extract order_id
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

 


    // Determine payment status
    let paymentStatus = 'pending';
    if (['successful', 'completed'].includes(fwStatus)) paymentStatus = 'completed';
    else if (['failed', 'cancelled'].includes(fwStatus)) paymentStatus = 'cancelled';
    console.log('📊 Derived payment status:', paymentStatus);

    // Update payments table
    console.log('💾 Updating payments table...');
    let updatedPayments;
    try {
      updatedPayments = await sql`
        UPDATE payments
        SET 
          status = ${paymentStatus},
          amount = ${data.amount || 0},
          currency = ${data.currency || 'NGN'},
          updated_at = NOW()
        WHERE tx_ref = ${txRef} OR payment_reference = ${txRef}
        RETURNING id, user_id, order_id, payment_reference, tx_ref, payment_type;
      `;
    } catch (err) {
      console.error('💥 Failed to update payments:', err);
      return res.status(500).send('Database error');
    }

    if (!updatedPayments || updatedPayments.length === 0) {
      console.warn(`⚠️ No payment found for tx_ref: ${txRef}`);
      return res.status(404).send('Payment not found');
    }

    const payment = updatedPayments[0];
    const { user_id: userId } = payment;
    const finalOrderId = orderId || payment.order_id;
    console.log('🔗 Final order_id:', finalOrderId, '| User ID:', userId);

    const paymentType = payment.payment_type;
    console.log('💰 Payment type (DB):', paymentType);

    // Compute new order status
    let orderStatus = 'pending';
    if (paymentType === 'order') {
      if (paymentStatus === 'completed') orderStatus = 'en_route';
      else if (paymentStatus === 'cancelled') orderStatus = 'pending';
    } else if (['delivery', 'delivery_fee'].includes(paymentType)) {
      if (paymentStatus === 'completed') orderStatus = 'en_route';
      else if (paymentStatus === 'cancelled') orderStatus = 'pending';
    }

    // Update orders table
    if (finalOrderId) {
      console.log('💾 Updating orders table...');
      await sql`
        UPDATE orders
        SET status = ${orderStatus}, updated_at = NOW()
        WHERE id = ${finalOrderId};
      `;
      console.log(`🧾 Order ${finalOrderId} status updated to ${orderStatus}`);
    }

    // Courier auto-assignment
    if (['delivery', 'delivery_fee'].includes(paymentType) && paymentStatus === 'completed') {
      try {
        console.log(`🚚 Delivery fee confirmed for order ${finalOrderId}, starting auto-assignment...`);
        const assignResult = await finalizeDeliveryAfterPaymentAuto(finalOrderId);
        console.log('✅ finalizeDeliveryAfterPaymentAuto result:', assignResult);
      } catch (assignErr) {
        console.error('💥 Error during courier assignment:', assignErr);
      }
    }

    if (
      ['delivery', 'delivery_fee'].includes(paymentType) &&
      paymentStatus === 'completed' &&
      finalOrderId
    ) {
      console.log('🚚 Updating delivery status to EN_ROUTE...');
    
      const updated = await sql`
        UPDATE deliveries
        SET status = 'en_route',
            updated_at = NOW()
        WHERE order_id = ${finalOrderId}
        RETURNING id, status;
      `;
    
      if (updated.length === 0) {
        console.warn('⚠️ No delivery found for order:', finalOrderId);
      } else {
        console.log('✅ Delivery marked EN_ROUTE:', updated[0]);
      }
    }
    
    

    // Notify user via Socket.IO
    if (userId && ioInstance) {
      let message = '';
      if (paymentType === 'order') {
        if (paymentStatus === 'completed') message = `🎉 Your order payment (ref: ${txRef}) was successful!`;
        else if (paymentStatus === 'cancelled') message = `⚠️ Your order payment (ref: ${txRef}) was cancelled.`;
        else message = `ℹ️ Your order payment (ref: ${txRef}) is ${paymentStatus}.`;
      } else if (['delivery', 'delivery_fee'].includes(paymentType)) {
        if (paymentStatus === 'completed') message = `🚚 Delivery fee (ref: ${txRef}) paid successfully! Courier assigned automatically.`;
        else if (paymentStatus === 'cancelled') message = `⚠️ Delivery payment (ref: ${txRef}) was cancelled.`;
        else message = `ℹ️ Your delivery payment (ref: ${txRef}) is ${paymentStatus}.`;
      }

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

    console.log('✅ Webhook fully processed.\n');
    return res.status(200).send('Webhook processed successfully');
  }
);




module.exports = router;
