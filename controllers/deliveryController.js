// controllers/deliveryController.js
const { sql } = require('../db');
const axios = require('axios');

exports.finalizeDeliveryAfterPayment = async (req, res) => {
  const { order_id, courier_id } = req.body;

  if (!order_id || !courier_id) {
    return res.status(400).json({ success: false, message: 'order_id and courier_id are required' });
  }

  try {
    // 1️⃣ Verify order exists and payment is completed
    const [order] = await sql`
      SELECT id, status, user_id, delivery_address, delivery_fee
      FROM orders
      WHERE id = ${order_id};
    `;

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.status !== 'paid') {
      return res.status(400).json({ success: false, message: 'Order not paid yet' });
    }

    // 2️⃣ Verify courier exists and is verified/available
    const [courier] = await sql`
      SELECT id, full_name, phone, vehicle_type, vehicle_plate, verification_status, availability
      FROM couriers
      WHERE id = ${courier_id};
    `;

    if (!courier) {
      return res.status(404).json({ success: false, message: 'Courier not found' });
    }

    if (courier.verification_status !== 'approved') {
      return res.status(400).json({ success: false, message: 'Courier not approved' });
    }

    if (courier.availability === 'Offline') {
      return res.status(400).json({ success: false, message: 'Courier is currently offline' });
    }

    // 3️⃣ Create a delivery record
    const [delivery] = await sql`
      INSERT INTO deliveries (order_id, courier_id, status, assigned_at)
      VALUES (${order_id}, ${courier_id}, 'assigned', NOW())
      RETURNING *;
    `;

    // 4️⃣ Update the order to link courier + status
    await sql`
      UPDATE orders
      SET status = 'courier_assigned',
          courier_id = ${courier_id},
          updated_at = NOW()
      WHERE id = ${order_id};
    `;

    // 5️⃣ Mark courier as "Busy"
    await sql`
      UPDATE couriers
      SET availability = 'Busy'
      WHERE id = ${courier_id};
    `;

    // 6️⃣ Response to frontend
    res.status(200).json({
      success: true,
      message: 'Courier successfully assigned to paid order',
      delivery,
      courier,
      order,
    });
  } catch (err) {
    console.error('❌ Error finalizing delivery after payment:', err);
    res.status(500).json({
      success: false,
      message: 'Internal server error while finalizing delivery',
    });
  }
};
