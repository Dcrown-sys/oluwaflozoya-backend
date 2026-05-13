// ============================================================
// routes/quoteMessagesRoutes.js
// ============================================================
const express = require('express');
const router  = express.Router({ mergeParams: true }); // ← mergeParams to get :requestId
const { verifyToken } = require('../middleware/auth');
const { validate }    = require('../middleware/validate');
const { sendMessageSchema, markReadSchema } = require('../validators/quoteMessagesValidators');
const ctrl = require('../controllers/quoteMessagesController');

router.use(verifyToken);

// GET  /api/v2/quotes/requests/:requestId/messages       — load thread
router.get('/',    ctrl.list);

// POST /api/v2/quotes/requests/:requestId/messages       — send a message
router.post('/',   validate(sendMessageSchema), ctrl.send);

// POST /api/v2/quotes/requests/:requestId/messages/read  — mark thread as read
router.post('/read', ctrl.markRead);

module.exports = router;