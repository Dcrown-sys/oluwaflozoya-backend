const { sql } = require('../db');
const axios = require('axios');

// ==============================
// GET all orders (latest first)
// ==============================
exports.getAllOrders = async (req, res) => {
  try {
    const orders = await sql`
      SELECT 
        o.*,
        json_build_object(
          'id', u.id,
          'full_name', u.full_name,
          'phone', u.phone,
          'email', u.email
        ) AS buyer,
        json_build_object(
          'id', c.id,
          'full_name', c.full_name,
          'phone', c.phone,
          'vehicle_type', c.vehicle_type,
          'vehicle_plate', c.vehicle_plate
        ) AS courier,
        COALESCE(
          json_agg(
            json_build_object(
              'id', oi.id,
              'product_id', oi.product_id,
              'name', p.name,
              'quantity', oi.quantity,
              'unit_price', oi.unit_price,
              'total_price', oi.total_price
            )
          ) FILTER (WHERE oi.id IS NOT NULL),
          '[]'
        ) AS items
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN couriers c ON o.courier_id = c.id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON oi.product_id = p.id
      GROUP BY o.id, u.id, c.id
      ORDER BY o.created_at DESC
    `;

    res.json({ success: true, orders });
  } catch (err) {
    console.error('❌ Error fetching all orders:', err);
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
};

// ==============================
// PATCH mark order as received
// ==============================
exports.markOrderAsReceived = async (req, res) => {
  const { orderId } = req.params;

  try {
    const result = await sql`
      UPDATE orders 
      SET status = 'received', updated_at = NOW()
      WHERE id = ${orderId}
      RETURNING *;
    `;

    if (result.length === 0)
      return res.status(404).json({ message: 'Order not found' });

    res.json({ success: true, message: 'Order marked as received', order: result[0] });
  } catch (err) {
    console.error('❌ Error marking order as received:', err);
    res.status(500).json({ message: 'Failed to mark order as received' });
  }
};

// ==============================
// POST assign courier
// ==============================
exports.assignCourier = async (req, res) => {
  const { orderId } = req.params;
  const { pickup_address, dropoff_address, courier_id } = req.body;

  if (!pickup_address || !dropoff_address)
    return res.status(400).json({ message: 'Pickup and dropoff addresses required' });

  try {
    // 1️⃣ Geocode both addresses to get coordinates
    const geocodeAPI = process.env.GEOCODE_API_URL || 'https://maps.googleapis.com/maps/api/distancematrix/json';
    const googleKey = process.env.GOOGLE_MAPS_KEY;

    const distanceRes = await axios.get(geocodeAPI, {
      params: {
        origins: pickup_address,
        destinations: dropoff_address,
        key: googleKey,
      },
    });

    const distanceData = distanceRes.data.rows[0].elements[0];
    const distanceKm = distanceData.distance.value / 1000; // meters → km

    // 2️⃣ Calculate fee (e.g. ₦200 per km)
    const ratePerKm = 200;
    const deliveryFee = Math.round(distanceKm * ratePerKm);

    // 3️⃣ Update order in DB
    const updated = await sql`
      UPDATE orders
      SET courier_id = ${courier_id},
          pickup_address = ${pickup_address},
          delivery_address = ${dropoff_address},
          delivery_fee = ${deliveryFee},
          status = 'courier_assigned',
          updated_at = NOW()
      WHERE id = ${orderId}
      RETURNING *;
    `;

    if (updated.length === 0)
      return res.status(404).json({ message: 'Order not found' });

    // 4️⃣ Fetch courier info
    const [courier] = await sql`SELECT id, full_name, phone, vehicle_type, vehicle_plate FROM couriers WHERE id = ${courier_id}`;

    // 5️⃣ Respond with courier + delivery details
    res.json({
      success: true,
      message: 'Courier assigned successfully',
      courier,
      distance_km: distanceKm,
      delivery_fee: deliveryFee,
    });
  } catch (err) {
    console.error('❌ Error assigning courier:', err.response?.data || err.message);
    res.status(500).json({ message: 'Failed to assign courier' });
  }
};
