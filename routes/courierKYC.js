// routes/courierRoutes.js
const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const courierKYCController = require('../controllers/courierKYCController');
const { sql } = require('../db');
const multer = require('multer');

const storage = multer.memoryStorage();
const upload = multer({ storage });

// 🧾 Submit KYC
router.post(
  '/kyc',
  verifyToken,
  upload.fields([
    { name: 'selfie', maxCount: 1 },
    { name: 'document', maxCount: 1 },
  ]),
  courierKYCController.submitKYC
);

// 🧠 Get courier info (including verification_status)
router.get('/me', verifyToken, async (req, res) => {
  try {
    console.log('🪪 Fetching user + courier info for user_id:', req.user.id);

    const result = await sql`
      SELECT 
        u.id AS user_id,
        u.full_name,
        u.email,
        u.phone,
        u.role,
        u.status,
        c.id AS courier_id,
        c.verification_status,
        c.vehicle_type,
        c.vehicle_plate,
        c.selfie_url,
        c.document_url
      FROM users u
      LEFT JOIN couriers c ON c.user_id = u.id
      WHERE u.id = ${req.user.id}
      LIMIT 1
    `;

    if (!result.length) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const row = result[0];

    // Split user and courier data
    const user = {
      id: row.user_id,
      full_name: row.full_name,
      email: row.email,
      phone: row.phone,
      role: row.role,
      status: row.status,
    };

    const courier = row.courier_id
      ? {
          id: row.courier_id,
          verification_status: row.verification_status,
          vehicle_type: row.vehicle_type,
          vehicle_plate: row.vehicle_plate,
          selfie_url: row.selfie_url,
          document_url: row.document_url,
        }
      : null;

    // Optionally prepend BASE_URL to images
    const BASE_URL = process.env.BASE_URL || 'https://oluwaflozoya-backend.onrender.com';
    if (courier?.selfie_url) courier.selfie_url = `${BASE_URL}${courier.selfie_url}`;
    if (courier?.document_url) courier.document_url = `${BASE_URL}${courier.document_url}`;

    res.json({ success: true, user, courier });
  } catch (err) {
    console.error('❌ /api/courier/me error:', err.message);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});



module.exports = router;
