const express = require('express');
const router = express.Router();
const { getCategories } = require('../controllers/adminController');  // For getCategories
const { getProducersByCategory } = require('../controllers/adminController'); 
const { getProductsByProducer } =require('../controllers/adminController');
const { calculateTransport } = require('../controllers/adminController');
const { searchProducts } = require('../controllers/adminController');
const { getAllProducts } = require('../controllers/adminController');

router.get('/', getCategories);  // Public GET /api/categories
router.get('/:categoryId/producers', getProducersByCategory); 
router.get('/:producerId/products', getProductsByProducer);
router.post('/calculate-transport', calculateTransport);
router.get('/products/search', searchProducts);
router.get('/products', getAllProducts);
module.exports = router;