// routes/quoteSuggestionsRoutes.js
const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { suggestionsQuerySchema } = require('../validators/quoteRequestsValidators');
const ctrl = require('../controllers/quoteSuggestionsController');

router.get('/', verifyToken, validate(suggestionsQuerySchema, 'query'), ctrl.search);

module.exports = router;