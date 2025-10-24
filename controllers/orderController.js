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
    if (!order)
      return res.status(404).json({ success: false, message: 'Order not found' });

    // 2️⃣ Generate payment reference for delivery
    const tx_ref = `DELIVERY-${order_id}-${Date.now()}`;

    // 3️⃣ Create Flutterwave payment link for delivery fee
    const fwPayload = {
      tx_ref,
      amount: delivery_fee,
      currency: 'NGN',
      redirect_url: `${process.env.FRONTEND_URL}/payment-success`,
      customer: {
        id: order.user_id,
        email: 'buyer@email.com', // 🔁 Replace with actual user email
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
      return res.status(500).json({
        success: false,
        message: 'Failed to create delivery payment link',
      });
    }

    const paymentLink = flwResponse.data.link;

    // 4️⃣ Insert record into payments table
    await sql`
      INSERT INTO payments (
        order_id, user_id, amount, status,
        payment_reference, tx_ref, payment_method,
        currency, payment_type, created_at
      )
      VALUES (
        ${order_id}, ${order.user_id}, ${delivery_fee}, 'pending',
        ${paymentLink}, ${tx_ref}, 'flutterwave',
        'NGN', 'delivery', NOW()
      );
    `;

    // 5️⃣ Update order with courier info and delivery status
    await sql`
      UPDATE orders
      SET courier_id = ${courier_id},
          pickup_address = ${pickup_address},
          delivery_address = ${dropoff_address},
          delivery_fee = ${delivery_fee},
          status = 'delivery_pending',
          updated_at = NOW()
      WHERE id = ${order_id};
    `;

    // 6️⃣ Respond with payment link and tx_ref
    res.status(200).json({
      success: true,
      message: 'Delivery payment link created successfully',
      payment_link: paymentLink,
      tx_ref,
    });
  } catch (err) {
    console.error('❌ Error assigning courier:', err);
    res.status(500).json({
      success: false,
      message: 'Internal server error assigning courier',
    });
  }
};
