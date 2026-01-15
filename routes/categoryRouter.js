const express = require('express');
const router = express.Router();
const { getCategories } = require('../controllers/adminController');  // For getCategories
const { getProducersByCategory } = require('../controllers/adminController'); 
const { getProductsByProducer } =require('../controllers/adminController');

router.get('/', getCategories);  // Public GET /api/categories
router.get('/:categoryId/producers', getProducersByCategory); 
router.get('/:producerId/products', getProductsByProducer);

module.exports = router;