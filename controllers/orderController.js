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

    const [order] = await sql`
      SELECT id, user_id, status FROM orders WHERE id = ${order_id};
    `;
    if (!order)
      return res.status(404).json({ success: false, message: 'Order not found' });

    const tx_ref = `DELIVERY-${order_id}-${Date.now()}`;

    const fwPayload = {
      tx_ref,
      amount: delivery_fee,
      currency: 'NGN',
      redirect_url: `${process.env.FRONTEND_URL}/payment-success`,
      customer: {
        id: order.user_id,
        email: 'buyer@email.com',
      },
      meta: { order_id, courier_id, type: 'delivery' },
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


// ✅ GET ORDER DETAILS — with exact deliveries column names
exports.getOrderDetails = async (req, res) => {
  const { order_id } = req.params;

  if (!order_id) {
    return res.status(400).json({ success: false, message: 'order_id is required' });
  }

  try {
    // 1️⃣ Order
    const [order] = await sql`
      SELECT
        o.id            AS order_id,
        o.user_id,
        o.status        AS order_status,
        o.total_amount,
        o.pickup_address,
        o.delivery_address,
        o.delivery_fee,
        o.created_at,
        o.updated_at
      FROM orders o
      WHERE o.id = ${order_id}
      LIMIT 1;
    `;

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // 2️⃣ Delivery — using exact column names from your schema
    const [delivery] = await sql`
      SELECT
        d.id                AS delivery_id,
        d.order_id,
        d.courier_id,
        d.status            AS delivery_status,
        d.pickup_address,
        d.pickup_latitude,       -- ✅ exact column name
        d.pickup_longitude,      -- ✅ exact column name
        d.dropoff_address,
        d.dropoff_latitude,      -- ✅ exact column name
        d.dropoff_longitude,     -- ✅ exact column name
        d.delivery_fee,
        d.distance_km,
        d.eta,
        d.eta_minutes,
        d.last_location,         -- courier's last known location (JSON or text)
        d.assigned_at,
        d.picked_up_at,
        d.delivered_at,
        d.created_at        AS delivery_created_at,
        d.updated_at        AS delivery_updated_at
      FROM deliveries d
      WHERE d.order_id = ${order_id}
      LIMIT 1;
    `;

    // 3️⃣ Payment status — from payments table
    const [payment] = await sql`
      SELECT status AS payment_status, amount AS payment_amount
      FROM payments
      WHERE order_id = ${order_id}
        AND payment_type = 'delivery'
      ORDER BY created_at DESC
      LIMIT 1;
    `;

    // 4️⃣ Courier info
    let courierInfo = null;
    if (delivery?.courier_id) {
      const [courier] = await sql`
        SELECT
          c.id,
          c.full_name,
          c.phone,
          c.vehicle_type,
          c.vehicle_plate
        FROM couriers c
        WHERE c.user_id = ${delivery.courier_id}
        LIMIT 1;
      `;
      courierInfo = courier || null;
    }

    // 5️⃣ Order items
    const items = await sql`
      SELECT
        oi.id             AS order_item_id,
        oi.product_id,
        oi.quantity,
        oi.unit_price,
        oi.total_price,
        p.name            AS product_name,
        p.description     AS product_description,
        p.image_url       AS product_image
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ${order_id};
    `;

    // 6️⃣ Parse last_location if it's stored as JSON string
    //    last_location may look like: '{"lat": 6.5244, "lng": 3.3792}'
    let courierLat = null;
    let courierLng = null;
    if (delivery?.last_location) {
      try {
        const loc = typeof delivery.last_location === 'string'
          ? JSON.parse(delivery.last_location)
          : delivery.last_location;
        courierLat = loc?.lat ?? loc?.latitude ?? null;
        courierLng = loc?.lng ?? loc?.longitude ?? null;
      } catch (_) {
        // last_location not valid JSON — leave as null
      }
    }

    res.json({
      success: true,
      message: 'Order details retrieved successfully',
      order: {
        // Order core
        order_id:       order.order_id,
        user_id:        order.user_id,
        order_status:   order.order_status,
        total_amount:   order.total_amount,
        created_at:     order.created_at,
        updated_at:     order.updated_at,

        // Delivery core
        delivery_id:         delivery?.delivery_id        || null,
        delivery_status:     delivery?.delivery_status    || null,
        delivery_fee:        delivery?.delivery_fee       || order.delivery_fee,
        distance_km:         delivery?.distance_km        || null,
        eta:                 delivery?.eta                || null,
        eta_minutes:         delivery?.eta_minutes        || null,
        assigned_at:         delivery?.assigned_at        || null,
        picked_up_at:        delivery?.picked_up_at       || null,
        delivered_at:        delivery?.delivered_at       || null,
        delivery_created_at: delivery?.delivery_created_at || null,
        delivery_updated_at: delivery?.delivery_updated_at || null,

        // Payment
        payment_status: payment?.payment_status || null,
        payment_amount: payment?.payment_amount || null,

        // Addresses
        pickup_address:  delivery?.pickup_address  || order.pickup_address  || null,
        dropoff_address: delivery?.dropoff_address || order.delivery_address || null,

        // ✅ Coordinates — now correctly mapped
        pickup_lat:  delivery?.pickup_latitude  || null,
        pickup_lng:  delivery?.pickup_longitude || null,
        dropoff_lat: delivery?.dropoff_latitude  || null,
        dropoff_lng: delivery?.dropoff_longitude || null,

        // ✅ Live courier location parsed from last_location JSON
        courier_lat: courierLat,
        courier_lng: courierLng,

        // Courier identity
        courier_id:    delivery?.courier_id       || null,
        courier_name:  courierInfo?.full_name      || null,
        courier_phone: courierInfo?.phone          || null,
        vehicle_type:  courierInfo?.vehicle_type   || null,
        vehicle_plate: courierInfo?.vehicle_plate  || null,

        // Items
        items: items || [],
      },
    });
  } catch (err) {
    console.error('❌ Error fetching order details:', err);
    res.status(500).json({
      success: false,
      message: 'Internal server error fetching order details',
    });
  }
};