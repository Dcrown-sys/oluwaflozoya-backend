const express = require('express');
const router = express.Router();
const { payOrderDelivery } = require('../controllers/paymentsController');
const { verifyBuyer } = require('../middleware/auth'); // <- use this

// Only buyers can pay delivery fees
router.post('/order/:orderId', verifyBuyer, payOrderDelivery);

module.exports = router;
