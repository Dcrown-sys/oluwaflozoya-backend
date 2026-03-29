// controllers/paymentController.js
const { createDeliveryPaymentLink } = require('../utils/flutterwaveHelpers');
const { sql } = require('../db');
const axios = require('axios');
const crypto = require('crypto');


// ========================
// 1️⃣ Initiate Delivery Payment
// ========================
exports.payOrderDelivery = async (req, res) => {
  try {
    const { orderId, courierUserId } = req.body;
    const userId = req.user.id;

    // Fetch delivery (authoritative source of delivery fee)
    const [delivery] = await sql`
      SELECT d.id AS delivery_id, d.order_id, d.courier_id, d.delivery_fee,
             o.user_id AS buyer_id, o.name AS buyer_name, o.email AS buyer_email, o.phone_number AS buyer_phone
      FROM deliveries d
      JOIN orders o ON o.id = d.order_id
      WHERE d.order_id = ${orderId}
        AND d.courier_id = (SELECT id FROM couriers WHERE user_id = ${courierUserId})
      LIMIT 1;
    `;
    if (!delivery) return res.status(404).json({ message: 'Delivery not found for this order/courier' });

    // Format phone number
    const phoneNumber = delivery.buyer_phone.startsWith('0')
      ? '+234' + delivery.buyer_phone.slice(1)
      : delivery.buyer_phone;

    // Upsert payment (prevent duplicates)
    const txRef = `DELIVERY-${orderId}-${Date.now()}`;
    const [payment] = await sql`
      INSERT INTO payments (
        tx_ref, payment_reference, order_id, user_id, courier_id,
        amount, currency, status, payment_type, created_at, updated_at
      )
      VALUES (
        ${txRef}, NULL, ${orderId}, ${userId}, ${delivery.courier_id},
        ${delivery.delivery_fee}, 'NGN', 'pending', 'delivery_fee', NOW(), NOW()
      )
      ON CONFLICT (order_id, payment_type)
      DO UPDATE SET tx_ref = EXCLUDED.tx_ref, updated_at = NOW()
      RETURNING *;
    `;

    // Build Flutterwave payload
    const paymentData = {
      tx_ref: payment.tx_ref,
      amount: delivery.delivery_fee,
      currency: 'NGN',
      customer: {
        name: delivery.buyer_name,
        email: delivery.buyer_email,
        phonenumber: phoneNumber,
      },
      meta: {
        order_id: orderId,
        user_id: userId,
        courier_id: delivery.courier_id,
        payment_type: 'delivery_fee',
      },
      customizations: {
        title: 'Zoya Delivery Fee',
        description: `Payment for delivery of order ${orderId}`,
      },
    };

    // Create Flutterwave payment link
    const fwResponse = await createDeliveryPaymentLink(paymentData);
    if (!fwResponse?.link) {
      console.error('❌ Failed to create Flutterwave payment link', fwResponse);
      return res.status(500).json({ message: 'Failed to create payment link' });
    }

    // Update payment_reference after link creation
    await sql`
      UPDATE payments
      SET payment_reference = ${fwResponse.id}, updated_at = NOW()
      WHERE id = ${payment.id};
    `;

    res.json({
      success: true,
      paymentLink: fwResponse.link,
      txRef: payment.tx_ref,
    });
  } catch (err) {
    console.error('❌ Error initiating delivery payment:', err.response?.data || err.message);
    res.status(500).json({ message: 'Failed to initiate payment' });
  }
};

// ========================
// 2️⃣ Centralized Payment Finalization
// ========================
exports.finalizeDeliveryAfterPayment = async ({ tx_ref, flw_ref, meta }) => {
  try {
    const orderId = meta?.order_id;
    const userId = meta?.user_id;
    const courierId = meta?.courier_id;

    if (!orderId || !courierId) return console.warn('⚠️ Missing order or courier ID for finalization');

    // Mark payment as completed
    await sql`
      UPDATE payments
      SET status = 'completed', flw_ref = ${flw_ref}, updated_at = NOW()
      WHERE tx_ref = ${tx_ref};
    `;

    // Update order
    await sql`
      UPDATE orders
      SET status = 'delivery_paid', courier_id = ${courierId}, updated_at = NOW()
      WHERE id = ${orderId};
    `;

    // Update or create delivery record
    const [existingDelivery] = await sql`
      SELECT id FROM deliveries WHERE order_id = ${orderId} AND courier_id = ${courierId} LIMIT 1;
    `;
    if (existingDelivery) {
      await sql`
        UPDATE deliveries
        SET status = 'enroute', updated_at = NOW()
        WHERE id = ${existingDelivery.id};
      `;
    } else {
      await sql`
        INSERT INTO deliveries (order_id, courier_id, status, created_at, updated_at)
        VALUES (${orderId}, ${courierId}, 'en_route', NOW(), NOW());
      `;
    }

    // Update courier status
    await sql`
      UPDATE couriers
      SET availability = 'Busy'
      WHERE id = ${courierId};
    `;

    console.log(`✅ Payment finalized and courier ${courierId} assigned for order ${orderId}`);
  } catch (err) {
    console.error('❌ finalizeDeliveryAfterPayment error:', err);
  }
};

// ========================
// 3️⃣ Webhook Handler
// ========================
exports.verifyFlutterwaveWebhook = async (req, res) => {
  try {
    const signature = req.headers['verif-hash'] || req.headers['verif_hash'];
    const payload = JSON.stringify(req.body);

    // ✅ Use the webhook secret, NOT API key
    const hash = crypto.createHmac('sha256', process.env.FLW_SECRET_KEY)
                   .update(payload)
                   .digest('hex');


    if (!signature || signature !== hash) {
      console.log('❌ Invalid webhook signature', signature, hash);
      return res.status(401).json({ success: false, message: 'Invalid Flutterwave signature' });
    }

    const { event, data } = req.body;
    if (event !== 'charge.completed' || !data) {
      return res.status(200).json({ success: true, message: 'Ignored non-charge event' });
    }

    const { tx_ref, status, id: flw_ref, meta } = data;

    if (status === 'successful' && meta?.payment_type === 'delivery_fee') {
      await exports.finalizeDeliveryAfterPayment({ tx_ref, flw_ref, meta });
      return res.status(200).json({ success: true, message: 'Payment finalized successfully' });
    }

    res.status(200).json({ success: true, message: 'Non-delivery transaction ignored' });
  } catch (err) {
    console.error('❌ Webhook error:', err);
    res.status(500).json({ success: false, message: 'Webhook error', error: err.message });
  }
};

// ========================
// 4️⃣ Manual Confirmation (Fallback)
// ========================
exports.confirmPayment = async (req, res) => {
  try {
    const { transaction_id, tx_ref, order_id } = req.body;
    if (!transaction_id && !tx_ref) {
      return res.status(400).json({ success: false, message: 'Missing transaction_id or tx_ref' });
    }

    const verifyUrl = transaction_id
      ? `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`
      : `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${tx_ref}`;

    const verifyRes = await axios.get(verifyUrl, {
      headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` },
    });

    const data = verifyRes.data?.data;
    if (!data || verifyRes.data.status !== 'success' || data.status !== 'successful') {
      return res.status(400).json({ success: false, message: data?.status || 'Unable to verify transaction' });
    }

    await exports.finalizeDeliveryAfterPayment({
      tx_ref: data.tx_ref,
      flw_ref: data.id,
      meta: data.meta,
    });

    res.status(200).json({
      success: true,
      message: 'Payment confirmed and delivery finalized successfully',
      data: {
        tx_ref: data.tx_ref,
        transaction_id: data.id,
        amount: data.amount,
        currency: data.currency,
        status: data.status,
      },
    });
  } catch (err) {
    console.error('❌ confirmPayment error:', err);
    res.status(500).json({ success: false, message: 'Error confirming payment', error: err.message });
  }
};

// ========================
// 5️⃣ Optional: Get Payment Info
// ========================
exports.getDeliveryPayment = async (req, res) => {
  try {
    const { order_id } = req.params;
    const user_id = req.user.id;

    const [payment] = await sql`
      SELECT * FROM payments
      WHERE order_id = ${order_id} AND user_id = ${user_id} AND payment_type = 'delivery_fee'
      LIMIT 1;
    `;

    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });

    res.json({ success: true, payment });
  } catch (err) {
    console.error('❌ getDeliveryPayment error:', err);
    res.status(500).json({ success: false, message: 'Error fetching payment info' });
  }
};
