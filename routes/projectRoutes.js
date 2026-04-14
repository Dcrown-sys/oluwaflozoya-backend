const express = require("express");
const router = express.Router();

const {
  getProjectDashboard,
  createProject,
  getBuyerProjects,
  getProjectMaterialPlans,
  createProjectMaterialPlan,
  getProjectMaterialPurchases,
  createProjectMaterialPurchase,
} = require("../controllers/projectController");

// project main routes
router.post("/projects", createProject);
router.get("/projects/buyer/:buyerId", getBuyerProjects);
router.get("/projects/:projectId/dashboard", getProjectDashboard);

// project material plans
router.get("/projects/:projectId/material-plans", getProjectMaterialPlans);
router.post("/projects/:projectId/material-plans", createProjectMaterialPlan);

// project material purchases
router.get("/projects/:projectId/material-purchases", getProjectMaterialPurchases);
router.post("/projects/:projectId/material-purchases", createProjectMaterialPurchase);

module.exports = router;