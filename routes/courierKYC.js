const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const upload = require('../middleware/upload');
const courierKYCController = require('../controllers/courierKYCController');

// KYC submission (selfie + document)
router.post(
  '/kyc',
  verifyToken,
  upload.fields([
    { name: 'selfie', maxCount: 1 },
    { name: 'document', maxCount: 1 }
  ]),
  courierKYCController.submitKYC
);

module.exports = router;
