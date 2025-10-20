// routes/adminKYCApproval.js
const express = require('express');
const router = express.Router();
const { verifyToken, verifyAdmin } = require('../middleware/auth');
const adminKYCApprovalController = require('../controllers/adminKYCApprovalController');

// ✅ Fetch all couriers
router.get('/kyc/couriers', verifyToken, verifyAdmin, adminKYCApprovalController.getAllCouriers);

// ✅ Approve or reject courier
router.put('/kyc/couriers/:id/status', verifyToken, verifyAdmin, adminKYCApprovalController.updateCourierStatus);

module.exports = router;
