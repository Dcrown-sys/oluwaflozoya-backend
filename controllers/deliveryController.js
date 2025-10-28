// controllers/deliveryController.js
const { sql } = require('../db');
const { v4: uuidv4 } = require('uuid');
const flutterwave = require('../utils/flutterwave');

/**
 * STEP 1: Admin creates a pending delivery and triggers buyer payment
 */
exports.createPendingDelivery = async (req, res) => {
  try {
    const { courier_id, order_id, pickup_address, dropoff_address, delivery_fee } = req.body;
    const adminId = req.user?.id; // from JWT (admin)

    if (!courier_id || !order_id || !pickup_address || !dropoff_address || !delivery_fee) {
      return res.status(400).json({ success: false, message: "Missing required fields." });
    }

    // ✅ Check if order exists
    const [order] = await sql`SELECT id, user_id, status FROM orders WHERE id = ${order_id};`;
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });

    // ✅ Prevent duplicate pending delivery
    const existing = await sql`
      SELECT id FROM deliveries WHERE order_id = ${order_id} AND status = 'pending';
    `;
    if (existing.length > 0)
      return res.status(400).json({ success: false, message: "Delivery already pending for this order." });

    // ✅ Generate tx_ref
    const tx_ref = `DELIVERY-${order_id}-${Date.now()}`;

    // ✅ Create delivery
    const [delivery] = await sql`
      INSERT INTO deliveries (
        courier_id, order_id, pickup_address, dropoff_address, delivery_fee,
        status, created_by, created_at, updated_at
      )
      VALUES (
        ${courier_id}, ${order_id}, ${pickup_address}, ${dropoff_address}, ${delivery_fee},
        'pending', ${adminId}, NOW(), NOW()
      )
      RETURNING id, order_id, courier_id, status;
    `;

    // ✅ Create pending payment entry
    await sql`
      INSERT INTO payments (
        order_id, user_id, amount, status, payment_reference, tx_ref,
        payment_method, currency, payment_type, created_at
      )
      VALUES (
        ${order_id}, ${order.user_id}, ${delivery_fee}, 'pending', NULL, ${tx_ref},
        'flutterwave', 'NGN', 'delivery_fee', NOW()
      );
    `;

    return res.json({
      success: true,
      message: "Delivery request created. Buyer notified to pay the delivery fee.",
      data: { ...delivery, tx_ref },
    });
  } catch (err) {
    console.error("❌ Error creating pending delivery:", err);
    res.status(500).json({ success: false, message: "Failed to create pending delivery." });
  }
};

/**
 * STEP 1.5: Get pending delivery for an order
 */
exports.getPendingDeliveryByOrder = async (req, res) => {
  const { order_id } = req.params;

  try {
    const [delivery] = await sql`
      SELECT 
        d.*, p.tx_ref, p.amount AS payment_amount, p.status AS payment_status
      FROM deliveries d
      LEFT JOIN payments p
        ON p.order_id = d.order_id
        AND p.tx_ref LIKE ${`DELIVERY-${order_id}%`}
      WHERE d.order_id = ${order_id}
        AND d.status = 'pending'
      LIMIT 1;
    `;

    if (!delivery)
      return res.status(404).json({ success: false, message: 'No pending delivery found' });

    res.json({ success: true, delivery });
  } catch (err) {
    console.error('❌ Error fetching pending delivery:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * STEP 2: Buyer initiates payment for the pending delivery (reuses cart structure)
 */
exports.initiateDeliveryPayment = async (req, res) => {
  try {
    const { order_id } = req.params;
    if (!order_id)
      return res.status(400).json({ success: false, message: 'order_id is required' });

    // ✅ Fetch delivery
    const [delivery] = await sql`
      SELECT id AS delivery_id, delivery_fee
      FROM deliveries
      WHERE order_id = ${order_id} AND status = 'pending'
      LIMIT 1;
    `;
    if (!delivery)
      return res.status(404).json({ success: false, message: 'No pending delivery found' });

    const { delivery_id, delivery_fee } = delivery;
    const amount = Number(delivery_fee);

    // ✅ Use existing tx_ref if available
    const [payment] = await sql`
      SELECT tx_ref FROM payments
      WHERE order_id = ${order_id} AND payment_type = 'delivery_fee'
      LIMIT 1;
    `;
    const tx_ref = payment?.tx_ref || `DELIVERY-${order_id}-${Date.now()}`;

    if (!payment) {
      await sql`
        INSERT INTO payments (
          order_id, user_id, amount, status, payment_reference, tx_ref,
          payment_method, currency, payment_type, created_at
        )
        VALUES (
          ${order_id},
          (SELECT user_id FROM orders WHERE id=${order_id}),
          ${amount}, 'pending', NULL, ${tx_ref},
          'flutterwave', 'NGN', 'delivery_fee', NOW()
        );
      `;
    }

    // ✅ Payload matches cart structure
    const fwPayload = {
      tx_ref,
      amount,
      currency: 'NGN',
      redirect_url: `${process.env.FRONTEND_URL || process.env.BASE_URL}/payment-success`,
      customer: {
        email: req.user?.email || 'zoyaprocurementcompany@gmail.com',
        name: req.user?.name || 'Oluwaflo Buyer',
      },
      meta: {
        order_id,
        delivery_id,
        type: 'delivery_fee',
      },
    };

    // ✅ Generate payment link
    const fwResponse = await flutterwave.createPaymentLink(fwPayload);

    const paymentLink =
      fwResponse?.data?.link ||
      fwResponse?.link ||
      fwResponse?.data?.checkout_url ||
      fwResponse?.data?.payment_link;

    if (!paymentLink) {
      console.error('❌ Flutterwave create returned unexpected:', fwResponse);
      return res.status(500).json({ success: false, message: 'Failed to get payment link from Flutterwave' });
    }

    // ✅ Update payment reference
    await sql`
      UPDATE payments
      SET payment_reference = ${paymentLink}, updated_at = NOW()
      WHERE tx_ref = ${tx_ref};
    `;

    return res.json({
      success: true,
      message: 'Delivery payment initialized',
      payment_url: paymentLink,
      tx_ref,
    });
  } catch (err) {
    console.error('❌ Error initiating delivery payment:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * STEP 3: Finalize after successful payment
 */
exports.finalizeDeliveryAfterPayment = async (req, res) => {
  const { order_id, courier_id } = req.body;

  if (!order_id || !courier_id) {
    return res.status(400).json({
      success: false,
      message: 'order_id and courier_id are required',
    });
  }

  try {
    // ✅ Confirm order and paid status
    const [order] = await sql`
      SELECT id, status, user_id, delivery_address, pickup_address, delivery_fee
      FROM orders
      WHERE id = ${order_id};
    `;
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    if (order.status !== 'delivery_paid')
      return res.status(400).json({ success: false, message: 'Delivery fee not paid yet' });

    // ✅ Confirm courier availability
    const [courier] = await sql`
      SELECT id, full_name, phone, vehicle_type, vehicle_plate, verification_status, availability
      FROM couriers
      WHERE id = ${courier_id};
    `;
    if (!courier) return res.status(404).json({ success: false, message: 'Courier not found' });
    if (courier.verification_status !== 'approved')
      return res.status(400).json({ success: false, message: 'Courier not approved' });
    if (courier.availability === 'Offline')
      return res.status(400).json({ success: false, message: 'Courier is currently offline' });

    // ✅ Update delivery + order + courier
    const [delivery] = await sql`
      UPDATE deliveries
      SET status = 'assigned', updated_at = NOW()
      WHERE order_id = ${order_id} AND courier_id = ${courier_id}
      RETURNING *;
    `;

    await sql`
      UPDATE orders
      SET status = 'courier_assigned', courier_id = ${courier_id}, updated_at = NOW()
      WHERE id = ${order_id};
    `;

    await sql`UPDATE couriers SET availability = 'Busy' WHERE id = ${courier_id};`;

    res.json({
      success: true,
      message: 'Courier assigned successfully after delivery fee payment.',
      delivery,
      courier,
      order,
    });
  } catch (err) {
    console.error('❌ Error finalizing delivery after payment:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
