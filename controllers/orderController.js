// controllers/orderController.js
const { sql } = require('../db');
const axios = require('axios');

exports.assignCourier = async (req, res) => {
  const adminId = req.user?.id;
  const { orderId } = req.params;
  const { courier_id, pickup_address, dropoff_address } = req.body;

  if (!adminId) return res.status(401).json({ success: false, message: 'Unauthorized' });
  if (!courier_id) return res.status(400).json({ success: false, message: 'Courier ID required' });

  try {
    const [order] = await sql`SELECT * FROM orders WHERE id = ${orderId}`;
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const [updatedOrder] = await sql`
      UPDATE orders
      SET courier_id = ${courier_id},
          pickup_address = ${pickup_address},
          delivery_address = ${dropoff_address},
          status = 'pending_delivery_payment'
      WHERE id = ${orderId}
      RETURNING *;
    `;

    const amount = order.delivery_fee || 0;
    const buyerEmail = order.buyer_email;
    if (!buyerEmail) return res.status(400).json({ success: false, message: 'Buyer email missing' });

    const paymentRequest = await axios.post(
      'https://api.flutterwave.com/v3/payments',
      {
        tx_ref: `DELIVERY-${orderId}-${Date.now()}`,
        amount,
        currency: 'NGN',
        redirect_url: `https://oluwaflozoya.vercel.app/order/${orderId}/payment-callback`,
        customer: { email: buyerEmail, phonenumber: order.buyer_phone, name: order.buyer_name },
        payment_type: 'delivery',
      },
      { headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' } }
    );

    const paymentLink = paymentRequest.data.data.link;

    await sql`
      INSERT INTO payments (order_id, user_id, amount, currency, status, payment_type, tx_ref, created_at)
      VALUES (${orderId}, ${order.buyer_id}, ${amount}, 'NGN', 'pending', 'delivery', ${paymentRequest.data.data.tx_ref}, NOW())
    `;

    res.status(200).json({ success: true, message: 'Courier assigned and delivery payment created', order: updatedOrder, payment_link: paymentLink });
  } catch (err) {
    console.error('❌ Error assigning courier:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
