const express = require('express');
const router = express.Router();
const { payOrderDelivery } = require('../controllers/paymentsController');
const { verifyBuyer } = require('../middleware/auth');
const { sql } = require('../db'); // needed for the new GET route

// 🟢 Buyer creates a new delivery payment (Flutterwave link)
router.post('/order/:orderId', verifyBuyer, payOrderDelivery);

// 🟡 Buyer fetches existing delivery payment info
router.get('/delivery/:order_id', verifyBuyer, async (req, res) => {
  try {
    const { order_id } = req.params;
    const user_id = req.user.id; // ensure only the buyer who owns the order can view it

    const [payment] = await sql`
      SELECT 
        payment_reference AS payment_link,
        status,
        tx_ref,
        amount,
        payment_type
      FROM payments
      WHERE order_id = ${order_id} 
        AND user_id = ${user_id}
        AND payment_type = 'delivery'
      LIMIT 1;
    `;

    if (!payment) {
      return res.status(404).json({ success: false, message: 'No delivery payment found for this order' });
    }

    res.json({ success: true, ...payment });
  } catch (err) {
    console.error('❌ Error fetching delivery payment:', err);
    res.status(500).json({ success: false, message: 'Error fetching delivery payment' });
  }
});

module.exports = router;
