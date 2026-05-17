// routes/quoteRequestsRoutes.js
const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');     // ← your existing middleware
const { validate } = require('../middleware/validate');
const {
  createQuoteRequestSchema,
  listQuoteRequestsSchema,
  updateQuoteRequestSchema,
} = require('../validators/quoteRequestsValidators');
const ctrl = require('../controllers/quoteRequestsController');

// 🔐 Every route requires a valid token. Buyer-vs-admin scoping is enforced in the service.
router.use(verifyToken);

router.get('/unread',                                            ctrl.unreadSummary);
router.get('/',          validate(listQuoteRequestsSchema, 'query'), ctrl.list);
router.get('/:id',                                               ctrl.getById);
router.post('/',         validate(createQuoteRequestSchema),     ctrl.create);
router.patch('/:id',     validate(updateQuoteRequestSchema),     ctrl.update);

// routes/quoteRequestsRoutes.js  ← add this one line + handler

// GET /api/v2/quotes/requests/unread-count
router.get('/unread-count', async (req, res) => {
  try {
    const userId = req.user.id;
    const [{ count }] = await sql`
      SELECT COUNT(*) FROM quote_request_messages qm
      JOIN quote_requests qr ON qr.id = qm.quote_request_id
      WHERE qr.user_id   = ${userId}
        AND qm.sender_type != 'buyer'
        AND qm.read_at     IS NULL
    `;
    res.json({ success: true, unread_count: Number(count) });
  } catch (err) {
    console.error('❌ unread-count error:', err.message);
    res.status(500).json({ success: false, unread_count: 0 });
  }
});

module.exports = router;