const express = require('express');
const router = express.Router();
const { getCategories } = require('../controllers/adminController');  // Import from adminController

router.get('/', getCategories);  // Public GET /api/categories
module.exports = router;