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
    console.log('🪪 Fetching courier info for user_id:', req.user.id);

    const result = await sql`
      SELECT id, user_id, full_name, phone, verification_status
      FROM couriers
      WHERE user_id = ${req.user.id}
      LIMIT 1
    `;

    console.log('✅ Query result:', result);

    if (!result.length) {
      console.log('⚠️ No courier found for user_id:', req.user.id);
      return res.status(404).json({ success: false, message: 'Courier not found' });
    }

    res.json({ success: true, courier: result[0] });
  } catch (err) {
    console.error('❌ /api/courier/me error:', err.message);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message, // 👈 this shows the actual SQL error
    });
  }
});


module.exports = router;
