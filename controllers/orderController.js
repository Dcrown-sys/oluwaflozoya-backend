// controllers/orderController.js
const { sql } = require('../db');
const { createDeliveryPaymentLink } = require('../utils/flutterwaveHelpers');

exports.assignCourier = async (req, res) => {
  const adminId = req.user?.id;
  const { orderId } = req.params;
  const { courierId, pickupAddress, dropoffAddress } = req.body;

  if (!adminId) 
    return res.status(401).json({ success: false, message: 'Unauthorized' });
    
  if (!courierId) 
    return res.status(400).json({ success: false, message: 'Courier ID required' });

  try {
    // 1️⃣ Fetch the order
    const [order] = await sql`SELECT * FROM orders WHERE id = ${orderId}`;
    if (!order) 
      return res.status(404).json({ success: false, message: 'Order not found' });

    // 2️⃣ Update order with courier assignment
    const [updatedOrder] = await sql`
      UPDATE orders
      SET courier_id = ${courierId},
          pickup_address = ${pickupAddress},
          delivery_address = ${dropoffAddress},
          status = 'pending'
      WHERE id = ${orderId}
      RETURNING id, user_id, status, created_at, delivery_address, pickup_address, courier_id;
    `;

    // 3️⃣ Prepare payment data for Flutterwave
    const txRef = `delivery-${orderId}-${Date.now()}`;
    const phoneNumber = order.phone_number.startsWith('0')
      ? '+234' + order.phone_number.slice(1)
      : order.phone_number;

    const paymentData = {
      amount: order.delivery_fee,
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

    // 4️⃣ Create delivery payment link
    const response = await createDeliveryPaymentLink(paymentData);
    const paymentLink = response.link;

    // 5️⃣ Insert payment record into DB
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
        ${response.id},
        ${orderId},
        ${order.user_id},
        ${order.delivery_fee},
        'NGN',
        'pending',
        'delivery',
        NOW(),
        NOW()
      )
    `;

    // 6️⃣ Return updated order + payment link
    res.status(200).json({
      success: true,
      message: 'Courier assigned and delivery payment created',
      order: updatedOrder,
      paymentLink,
    });

  } catch (err) {
    console.error('❌ Error assigning courier:', err.response?.data || err.message || err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
