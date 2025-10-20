const { sql } = require('../db');

let io = null; // Socket.IO instance

// ✅ Initialize Socket.IO instance
exports.setSocket = (socketInstance) => {
  io = socketInstance;
};

// ✅ Fetch all couriers (join users + couriers)
exports.getAllCouriers = async (req, res) => {
  try {
    const result = await sql`
      SELECT 
        c.id AS courier_id,
        c.user_id,
        c.verification_status,
        c.selfie_url,
        c.document_url,
        c.vehicle_type,
        c.vehicle_plate,
        c.created_at AS kyc_created_at,
        u.full_name,
        u.email,
        u.phone,
        u.latitude,
        u.longitude,
        u.created_at AS user_created_at
      FROM couriers c
      JOIN users u ON u.id = c.user_id
      ORDER BY c.created_at DESC
    `;

    // 👇 Add Firebase URLs or keep existing URLs
    const formattedCouriers = result.map((courier) => ({
      ...courier,
      selfie_url: courier.selfie_url || null,
      document_url: courier.document_url || null,
    }));

    res.json({
      success: true,
      couriers: formattedCouriers,
    });
  } catch (err) {
    console.error('❌ Error fetching couriers:', err);
    res.status(500).json({ success: false, message: 'Server error fetching couriers' });
  }
};

// ✅ Approve or reject courier KYC with notification
exports.updateCourierStatus = async (req, res) => {
  try {
    const { id } = req.params; // courier_id
    const { status } = req.body; // 'approved' or 'rejected'

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value' });
    }

    // Update courier KYC status
    const result = await sql`
      UPDATE couriers
      SET verification_status = ${status}, verified_at = NOW()
      WHERE id = ${id}
      RETURNING id, user_id, verification_status
    `;

    if (result.length === 0) {
      return res.status(404).json({ success: false, message: 'Courier not found' });
    }

    const updatedCourier = result[0];
    const user_id = updatedCourier.user_id;

    // 🔔 Prepare notification
    const message =
      status === 'approved'
        ? 'Your KYC has been approved! You can now start delivering.'
        : 'Your KYC has been rejected. Please check your documents and try again.';

    const title = status === 'approved' ? 'KYC Approved' : 'KYC Rejected';
    const type = status === 'approved' ? 'success' : 'warning';

    // ✅ Save notification in DB
    await sql`
      INSERT INTO notifications (user_id, title, body, data, read, created_at)
      VALUES (
        ${user_id},
        ${title},
        ${message},
        ${JSON.stringify({ type })},
        false,
        NOW()
      )
    `;

    // ✅ Emit notification via Socket.IO
    if (io) {
      io.to(`user_${user_id}`).emit('notification', {
        message,
        type,
      });
    }

    res.json({
      success: true,
      message: `Courier ${status} successfully`,
      courier: updatedCourier,
    });
  } catch (err) {
    console.error('❌ Error updating courier status:', err);
    res.status(500).json({ success: false, message: 'Server error updating status' });
  }
};
