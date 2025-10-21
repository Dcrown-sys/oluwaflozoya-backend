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

    const user = result[0];

    // Optionally prepend BASE_URL to images
    const BASE_URL = process.env.BASE_URL || 'https://oluwaflozoya-backend.onrender.com';
    if (user.selfie_url) user.selfie_url = `${BASE_URL}${user.selfie_url}`;
    if (user.document_url) user.document_url = `${BASE_URL}${user.document_url}`;

    res.json({ success: true, user });
  } catch (err) {
    console.error('❌ /api/courier/me error:', err.message);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});



module.exports = router;
