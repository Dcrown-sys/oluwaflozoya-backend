const express = require('express');
const router = express.Router();

// ✅ Import ALL 3 functions
const { 
  getProjectDashboard, 
  createProject, 
  getBuyerProjects 
} = require('../controllers/projectController');

// ✅ All routes now work
router.get('/projects/:projectId/dashboard', getProjectDashboard);
router.post('/projects', createProject);
router.get('/projects/buyer/:buyerId', getBuyerProjects);

module.exports = router;