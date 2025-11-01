// controllers/paymentController.js
const { createDeliveryPaymentLink } = require('../utils/flutterwaveHelpers');
const { sql } = require('../db');

// ================= PAY DELIVERY FEE =================
exports.payOrderDelivery = async (req, res) => {
  try {
    const { orderId, courierId } = req.body; // admin-selected courier
    const userId = req.user.id; // from JWT middleware

    // 1️⃣ Fetch the order
    const [order] = await sql`
      SELECT * FROM orders WHERE id = ${orderId} AND user_id = ${userId};
    `;
    if (!order) return res.status(404).json({ message: 'Order not found' });

    // 2️⃣ Fetch user info
    const [user] = await sql`
      SELECT name, email, phone_number FROM users WHERE id = ${userId};
    `;
    if (!user) return res.status(404).json({ message: 'User not found' });

    // 3️⃣ Format phone number
    const phoneNumber = user.phone_number.startsWith('0')
      ? '+234' + user.phone_number.slice(1)
      : user.phone_number;

    // 4️⃣ Build Flutterwave payment payload
    const txRef = `DELIVERY-${orderId}-${Date.now()}`;
    const paymentData = {
      tx_ref: txRef,
      amount: order.delivery_fee,
      currency: 'NGN',
      redirect_url: `oluwoflomobile://payment-success?status=completed&ref=${txRef}`,
      customer: {
        name: user.name,
        email: user.email,
        phonenumber: phoneNumber,
      },
      meta: {
        order_id: orderId,
        user_id: userId,
        courier_id: courierId,        // 👈 include selected courier
        payment_type: 'delivery_fee',
      },
      customizations: {
        title: 'Oluwaflo Delivery Fee',
        description: 'Payment for order delivery',
      },
    };

    console.log('🚀 Flutterwave Payload:', paymentData);

    // 5️⃣ Create payment link
    const response = await createDeliveryPaymentLink(paymentData);

    if (!response?.link) {
      console.error('❌ Failed to create Flutterwave payment link', response);
      return res.status(500).json({ message: 'Failed to create payment link' });
    }

    // 6️⃣ Save pending payment including courier_id
    await sql`
      INSERT INTO payments (
        tx_ref, payment_reference, order_id, user_id, courier_id,
        amount, currency, status, payment_type, created_at, updated_at
      )
      VALUES (
        ${txRef}, ${response.id || null}, ${orderId}, ${userId}, ${courierId},
        ${order.delivery_fee}, 'NGN', 'pending', 'delivery_fee', NOW(), NOW()
      );
    `;

    res.json({
      success: true,
      paymentLink: response.link,
      txRef,
    });
  } catch (err) {
    console.error('❌ Error initiating delivery payment:', err.response?.data || err.message);
    res.status(500).json({ message: 'Failed to initiate payment' });
  }
};

// ================= VERIFY FLUTTERWAVE WEBHOOK =================
exports.verifyFlutterwaveWebhook = async (req, res) => {
  try {
    const signature = req.headers['verif-hash'] || req.headers['verif_hash'];
    if (!signature || signature !== process.env.FLW_SECRET_HASH) {
      return res.status(401).json({ success: false, message: 'Invalid Flutterwave signature' });
    }

    const { event, data } = req.body;
    if (event !== 'charge.completed' || !data) {
      return res.status(200).json({ success: true, message: 'Ignored non-charge event' });
    }

    const { tx_ref, status, id: flw_ref, meta } = data;

    // Only handle delivery fee payments
    if (status === 'successful' && meta?.payment_type === 'delivery_fee') {
      const orderId = meta.order_id;
      const userId = meta.user_id;
      const courierId = meta.courier_id;

      console.log(`💳 Webhook received for order ${orderId}, user ${userId}, courier ${courierId}`);

      // 1️⃣ Mark payment as completed
      await sql`
        UPDATE payments 
        SET status = 'completed', flw_ref = ${flw_ref}, updated_at = NOW()
        WHERE tx_ref = ${tx_ref};
      `;

      // 2️⃣ Assign courier automatically
      if (courierId) {
        // Update orders table
        await sql`
          UPDATE orders
          SET courier_id = ${courierId}, status = 'assigned', updated_at = NOW()
          WHERE id = ${orderId};
        `;

        // Insert into deliveries table
        await sql`
          INSERT INTO deliveries (order_id, courier_id, status, created_at)
          VALUES (${orderId}, ${courierId}, 'assigned', NOW());
        `;
      }

      console.log(`✅ Auto-assigned courier ${courierId} for order ${orderId}`);
      return res.status(200).json({ success: true, message: 'Courier auto-assigned successfully' });
    }

    res.status(200).json({ success: true, message: 'Non-delivery transaction processed' });
  } catch (err) {
    console.error('❌ Webhook error:', err);
    res.status(500).json({ success: false, message: 'Webhook error', error: err.message });
  }
};
