const express = require('express');
const router = express.Router();
const { updateAvailability } = require('../controllers/courierSwitchController');
const { verifyToken } = require('../middleware/auth');

// Only couriers can change their own availability
router.put('/availability', verifyToken, updateAvailability);

module.exports = router;
