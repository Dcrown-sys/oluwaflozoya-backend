// controllers/orderController.js
const { sql } = require('../db');
const flutterwave = require('../utils/flutterwave');

exports.assignCourier = async (req, res) => {
  try {
    const { order_id, courier_id, delivery_fee, pickup_address, dropoff_address } = req.body;

    if (!order_id || !courier_id || !delivery_fee || !pickup_address) {
      return res.status(400).json({
        success: false,
        message: 'order_id, courier_id, delivery_fee, and pickup_address are required',
      });
    }

    // 1️⃣ Verify order exists
    const [order] = await sql`
      SELECT id, user_id, status FROM orders WHERE id = ${order_id};
    `;
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    // 2️⃣ Save courier & pickup/dropoff details into order
    await sql`
      UPDATE orders
      SET courier_id = ${courier_id},
          pickup_address = ${pickup_address},
          delivery_address = ${dropoff_address},
          delivery_fee = ${delivery_fee},
          status = 'pending',
          updated_at = NOW()
      WHERE id = ${order_id};
    `;
    await sql`
    UPDATE orders
    SET delivery_payment_link = ${paymentLink}, status = 'pending'
    WHERE id = ${orderId};
  `;
  

    // 3️⃣ Create Flutterwave payment link for delivery fee
    const tx_ref = `DELIVERY-${order_id}-${Date.now()}`;
    const fwPayload = {
      tx_ref,
      amount: delivery_fee,
      currency: 'NGN',
      redirect_url: `${process.env.FRONTEND_URL}/payment-success`,
      customer: {
        id: order.user_id,
        email: 'buyer@email.com', // Replace with actual user email from DB
      },
      meta: {
        order_id,
        courier_id,
        type: 'delivery',
      },
    };

    const flwResponse = await flutterwave.createPaymentLink(fwPayload);

    if (!flwResponse || !flwResponse.data?.link) {
      console.error('❌ Flutterwave link error:', flwResponse);
      return res.status(500).json({ success: false, message: 'Failed to create delivery payment link' });
    }

    // 4️⃣ Save payment reference
    await sql`
      INSERT INTO payments (user_id, order_id, tx_ref, amount, status, payment_type, created_at)
      VALUES (${order.user_id}, ${order_id}, ${tx_ref}, ${delivery_fee}, 'pending', 'delivery', NOW());
    `;

    // 5️⃣ Return payment link to frontend
    res.status(200).json({
      success: true,
      message: 'Delivery payment link generated successfully',
      payment_link: flwResponse.data.link,
    });
  } catch (err) {
    console.error('❌ Error assigning courier:', err);
    res.status(500).json({
      success: false,
      message: 'Internal server error assigning courier',
    });
  }
};
