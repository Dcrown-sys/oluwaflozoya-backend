const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const courierKYCController = require('../controllers/courierKYCController');
const multer = require('multer');

// Use memory storage to access files as buffers
const storage = multer.memoryStorage();
const upload = multer({ storage });

router.post(
  '/kyc',
  verifyToken,
  upload.fields([
    { name: 'selfie', maxCount: 1 },
    { name: 'document', maxCount: 1 },
  ]),
  courierKYCController.submitKYC
);

module.exports = router;
