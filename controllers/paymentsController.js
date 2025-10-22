const { createDeliveryPaymentLink } = require('../utils/flutterwaveHelpers');
const { sql } = require('../db');

// Initiate payment for order delivery
exports.payOrderDelivery = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id; // from JWT auth middleware

    // 1️⃣ Fetch the order
    const orders = await sql`SELECT * FROM orders WHERE id = ${orderId} AND user_id = ${userId}`;
    if (!orders || orders.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }
    const order = orders[0];

    // 2️⃣ Validate delivery fee
    if (!order.delivery_fee || order.delivery_fee < 1) {
      return res.status(400).json({ message: 'Invalid delivery fee amount' });
    }

    // 3️⃣ Fetch user info from DB (JWT may not include email/name)
    const users = await sql`SELECT name, email FROM users WHERE id = ${userId}`;
    if (!users || users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    const user = users[0];

    // 4️⃣ Prepare payment data
    const txRef = `delivery-${orderId}-${Date.now()}`;
    const paymentData = {
      amount: order.delivery_fee,
      currency: 'NGN',
      tx_ref: txRef,
      redirect_url: `${process.env.FRONTEND_URL}/orders/${orderId}/payment-success`,
      customer: {
        email: user.email,
        name: user.name,
      },
      payment_type: 'delivery',
      order_id: orderId,
      user_id: userId,
    };

    // 5️⃣ Create payment link via Flutterwave helper
    const response = await createDeliveryPaymentLink(paymentData);

    // 6️⃣ Save payment record in DB
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
        ${userId},
        ${order.delivery_fee},
        'NGN',
        'pending',
        'delivery',
        NOW(),
        NOW()
      )
    `;

    // 7️⃣ Return payment link
    res.json({ paymentLink: response.link, txRef });
  } catch (err) {
    console.error('❌ Error initiating delivery payment:', err);
    res.status(500).json({ message: 'Failed to initiate payment' });
  }
};
