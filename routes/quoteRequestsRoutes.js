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

module.exports = router;