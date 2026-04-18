const express = require("express");
const router = express.Router();

const {
  getProjectDashboard,
  createProject,
  getBuyerProjects,
  getProjectMaterialPlans,
  createProjectMaterialPlan,
  updateProjectMaterialPlan,
  getProjectMaterialPurchases,
  createProjectMaterialPurchase,
  updateProjectMaterialPurchase,
  deleteProjectMaterialPlan,
  updateProject,
  deleteProjectMaterialPurchase,
} = require("../controllers/projectController");

// project main routes
router.post("/projects", createProject);
router.get("/projects/buyer/:buyerId", getBuyerProjects);
router.get("/projects/:projectId/dashboard", getProjectDashboard);

// project material plans
router.get("/projects/:projectId/material-plans", getProjectMaterialPlans);
router.post("/projects/:projectId/material-plans", createProjectMaterialPlan);
router.put(
  "/projects/:projectId/material-plans/:materialPlanId",
  updateProjectMaterialPlan
);

// project material purchases
router.get("/projects/:projectId/material-purchases", getProjectMaterialPurchases);
router.post("/projects/:projectId/material-purchases", createProjectMaterialPurchase);
router.put(
  "/projects/:projectId/material-purchases/:purchaseId",
  updateProjectMaterialPurchase
);
router.put("/projects/:projectId", updateProject);

// 2. DELETE MATERIAL PLAN - Missing  
router.delete("/projects/:projectId/material-plans/:materialPlanId", deleteProjectMaterialPlan);

// 3. DELETE MATERIAL PURCHASE - Missing
router.delete("/projects/:projectId/material-purchases/:purchaseId", deleteProjectMaterialPurchase);

module.exports = router;