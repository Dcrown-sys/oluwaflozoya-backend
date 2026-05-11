const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middleware/auth");

const {
  getEngineerDashboard,
  confirmUsername,
} = require("../controllers/engineerController");

router.get("/dashboard", verifyToken, getEngineerDashboard);

router.post("/confirm-username", verifyToken, confirmUsername);

module.exports = router;