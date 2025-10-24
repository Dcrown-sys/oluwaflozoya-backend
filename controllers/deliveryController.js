// controllers/deliveryController.js
const { sql } = require('../db');

exports.finalizeDeliveryAfterPayment = async (req, res) => {
  const { order_id, courier_id } = req.body;

  if (!order_id || !courier_id) {
    return res.status(400).json({
      success: false,
      message: 'order_id and courier_id are required',
    });
  }

  try {
    // 1️⃣ Verify order exists and delivery fee has been paid
    const [order] = await sql`
      SELECT id, status, user_id, delivery_address, pickup_address, delivery_fee
      FROM orders
      WHERE id = ${order_id};
    `;

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Ensure delivery fee payment is confirmed
    if (order.status !== 'delivery_paid') {
      return res.status(400).json({
        success: false,
        message: 'Delivery fee not paid yet. Please confirm payment before assigning courier.',
      });
    }

    // 2️⃣ Verify courier exists and is approved + available
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

    // 3️⃣ Create a delivery record linked to order
    const [delivery] = await sql`
      INSERT INTO deliveries (
        order_id,
        courier_id,
        pickup_address,
        dropoff_address,
        delivery_fee,
        status,
        assigned_at
      )
      VALUES (
        ${order_id},
        ${courier_id},
        ${order.pickup_address || 'Unknown pickup'},
        ${order.delivery_address || 'Unknown dropoff'},
        ${order.delivery_fee || 0},
        'assigned',
        NOW()
      )
      RETURNING *;
    `;

    // 4️⃣ Update order to reflect courier assignment
    await sql`
      UPDATE orders
      SET status = 'courier_assigned',
          courier_id = ${courier_id},
          updated_at = NOW()
      WHERE id = ${order_id};
    `;

    // 5️⃣ Mark courier as busy
    await sql`
      UPDATE couriers
      SET availability = 'Busy'
      WHERE id = ${courier_id};
    `;

    // 6️⃣ Return success
    res.status(200).json({
      success: true,
      message: 'Courier assigned successfully after delivery fee payment.',
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
