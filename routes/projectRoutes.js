const express = require('express');
const router = express.Router();
const { getProjectDashboard } = require('../controllers/projectController');

// ✅ Project Dashboard
router.get('/projects/:projectId/dashboard', getProjectDashboard);

module.exports = router;