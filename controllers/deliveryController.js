// controllers/deliveryController.js
const { sql } = require('../db');

// STEP 1: Admin creates pending delivery and triggers buyer payment
exports.createPendingDelivery = async (req, res) => {
    try {
      const { courier_id, order_id, pickup_address, dropoff_address, delivery_fee } = req.body;
      const adminId = req.user.id; // from JWT
  
      if (!courier_id || !order_id || !pickup_address || !dropoff_address || !delivery_fee) {
        return res.status(400).json({ success: false, message: "Missing required fields." });
      }
  
      // ✅ Check if order exists
      const [order] = await sql`
        SELECT id, user_id, status FROM orders WHERE id = ${order_id};
      `;
      if (!order) {
        return res.status(404).json({ success: false, message: "Order not found." });
      }
  
      // ✅ Check if delivery already pending
      const existing = await sql`
        SELECT id FROM deliveries WHERE order_id = ${order_id} AND status = 'pending';
      `;
      if (existing.length > 0) {
        return res.status(400).json({ success: false, message: "Delivery already pending for this order." });
      }
  
      // ✅ Create Flutterwave payment reference
      const tx_ref = `DELIVERY-${order_id}-${Date.now()}`;
  
      // ✅ Generate payment link via Flutterwave
      const fwPayload = {
        tx_ref,
        amount: delivery_fee,
        currency: "NGN",
        redirect_url: `${process.env.FRONTEND_URL}/payment-success`,
        customer: {
          id: order.user_id,
          email: "buyer@email.com", // you can replace this dynamically later
        },
        meta: {
          order_id,
          courier_id,
          type: "delivery_fee",
        },
      };
  
      const flwResponse = await flutterwave.createPaymentLink(fwPayload);
  
      if (!flwResponse || !flwResponse.data?.link) {
        console.error("❌ Flutterwave link error:", flwResponse);
        return res.status(500).json({
          success: false,
          message: "Failed to create delivery payment link.",
        });
      }
  
      const paymentLink = flwResponse.data.link;
  
      // ✅ Insert into deliveries table (pending)
      const [delivery] = await sql`
        INSERT INTO deliveries (
          courier_id,
          order_id,
          pickup_address,
          dropoff_address,
          delivery_fee,
          status,
          created_by,
          created_at,
          updated_at
        ) VALUES (
          ${courier_id},
          ${order_id},
          ${pickup_address},
          ${dropoff_address},
          ${delivery_fee},
          'pending',
          ${adminId},
          NOW(),
          NOW()
        )
        RETURNING id, order_id, courier_id, status;
      `;
  
      // ✅ Log in payments table
      await sql`
        INSERT INTO payments (
          order_id,
          user_id,
          amount,
          status,
          payment_reference,
          tx_ref,
          payment_method,
          currency,
          payment_type,
          created_at
        )
        VALUES (
          ${order_id},
          ${order.user_id},
          ${delivery_fee},
          'pending',
          ${paymentLink},
          ${tx_ref},
          'flutterwave',
          'NGN',
          'delivery_fee',
          NOW()
        );
      `;
  
      // ✅ Respond to admin dashboard
      res.json({
        success: true,
        message: "Delivery request created. Buyer notified to pay delivery fee.",
        data: {
          ...delivery,
          payment_link: paymentLink,
        },
      });
    } catch (err) {
      console.error("❌ Error creating pending delivery:", err);
      res.status(500).json({ success: false, message: "Failed to create pending delivery." });
    }
  };

// In deliveryController.js
exports.getPendingDeliveryByOrder = async (req, res) => {
    const { order_id } = req.params;
    try {
      const [delivery] = await sql`
        SELECT * FROM deliveries
        WHERE order_id = ${order_id} AND status = 'pending'
        LIMIT 1;
      `;
      if (!delivery) return res.status(404).json({ success: false, message: 'No pending delivery found' });
  
      res.json({ success: true, delivery });
    } catch (err) {
      console.error('❌ Error fetching pending delivery:', err);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  };
  

// STEP 2: Finalize delivery after payment confirmation
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

    // 3️⃣ Update existing delivery to “assigned”
    const [delivery] = await sql`
      UPDATE deliveries
      SET status = 'assigned',
          updated_at = NOW()
      WHERE order_id = ${order_id} AND courier_id = ${courier_id}
      RETURNING *;
    `;

    // 4️⃣ Update order
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
