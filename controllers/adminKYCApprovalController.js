// controllers/adminKYCApprovalController.js
const { sql } = require('../db');

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

    // 👇 Add full URLs for image paths
    const BASE_URL = process.env.BASE_URL || "https://oluwaflozoya-backend.onrender.com";

    const formattedCouriers = result.map((courier) => ({
      ...courier,
      selfie_url: courier.selfie_url
        ? `${BASE_URL}${courier.selfie_url}`
        : null,
      document_url: courier.document_url
        ? `${BASE_URL}${courier.document_url}`
        : null,
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

// ✅ Approve or reject courier KYC
exports.updateCourierStatus = async (req, res) => {
  try {
    const { id } = req.params; // courier_id
    const { status } = req.body; // 'approved' or 'rejected'

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value' });
    }

    const result = await sql`
      UPDATE couriers
      SET verification_status = ${status}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, verification_status
    `;

    if (result.length === 0) {
      return res.status(404).json({ success: false, message: 'Courier not found' });
    }

    res.json({
      success: true,
      message: `Courier ${status} successfully`,
      courier: result[0],
    });
  } catch (err) {
    console.error('❌ Error updating courier status:', err);
    res.status(500).json({ success: false, message: 'Server error updating status' });
  }
};
