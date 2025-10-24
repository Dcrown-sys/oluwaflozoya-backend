// controllers/orderController.js
const { sql } = require('../db');
const { createDeliveryPaymentLink } = require('../utils/flutterwaveHelpers');

exports.assignCourier = async (req, res) => {
  const adminId = req.user?.id;
  const { orderId } = req.params;
  const { courier_id, pickup_address, dropoff_address, delivery_fee } = req.body; // ✅ include delivery_fee

  if (!adminId)
    return res.status(401).json({ success: false, message: 'Unauthorized' });

  if (!courier_id)
    return res.status(400).json({ success: false, message: 'Courier ID required' });

  try {
    // 1️⃣ Fetch the order
    const [order] = await sql`SELECT * FROM orders WHERE id = ${orderId}`;
    if (!order)
      return res.status(404).json({ success: false, message: 'Order not found' });

    // 2️⃣ Convert fee to number & validate
    const amount = Number(delivery_fee);
    if (!amount || amount < 1) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or missing delivery fee.',
      });
    }

    // 3️⃣ Update order with courier and delivery info
    const [updatedOrder] = await sql`
      UPDATE orders
      SET courier_id = ${courier_id},
          pickup_address = ${pickup_address || order.pickup_address},
          delivery_address = ${dropoff_address || order.delivery_address},
          delivery_fee = ${amount},            -- ✅ store the new fee
          status = 'pending'
      WHERE id = ${orderId}
      RETURNING id, user_id, status, created_at, delivery_address, pickup_address, courier_id, delivery_fee;
    `;

    // 4️⃣ Prepare Flutterwave payment data
    const txRef = `delivery-${orderId}-${Date.now()}`;
    const phoneNumber = order.phone_number?.startsWith('0')
      ? '+234' + order.phone_number.slice(1)
      : order.phone_number;

    const paymentData = {
      amount: amount, // ✅ use validated number
      currency: 'NGN',
      tx_ref: txRef,
      redirect_url: `${process.env.FRONTEND_URL}/orders/${orderId}/payment-success`,
      customer: {
        email: order.email,
        name: order.name,
        phonenumber: phoneNumber,
      },
      order_id: orderId,
      user_id: order.user_id,
    };

    // 5️⃣ Create delivery payment link
    const response = await createDeliveryPaymentLink(paymentData);
    if (!response?.link) {
      throw new Error(response?.message || 'Failed to create payment link with Flutterwave');
    }

    const paymentLink = response.link;

    // 6️⃣ Insert payment record into DB
    await sql`
      INSERT INTO payments (
        tx_ref,
        payment_reference,
        order_id,
        user_id,
        amount,
        currency,
        status,
        payment_type,
        created_at,
        updated_at
      )
      VALUES (
        ${txRef},
        ${response.id || null},
        ${orderId},
        ${order.user_id},
        ${amount}, -- ✅ use correct fee here too
        'NGN',
        'pending',
        'delivery',
        NOW(),
        NOW()
      )
    `;

    // 7️⃣ Return success response
    res.status(200).json({
      success: true,
      message: 'Courier assigned and delivery payment created successfully.',
      order: updatedOrder,
      paymentLink,
    });

  } catch (err) {
    console.error('❌ Error assigning courier:', err.response?.data || err.message || err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
