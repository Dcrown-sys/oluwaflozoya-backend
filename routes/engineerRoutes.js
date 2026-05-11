const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middleware/auth");

const {
  onboardEngineer,
  getEngineerDashboard,
  confirmUsername,
  getEngineerWallet,
  requestWithdrawal,
} = require("../controllers/engineerController");

router.post("/onboard", verifyToken, onboardEngineer);

router.get("/dashboard", verifyToken, getEngineerDashboard);

router.post("/confirm-username", verifyToken, confirmUsername);

router.get("/wallet", verifyToken, getEngineerWallet);

router.post("/withdrawals", verifyToken, requestWithdrawal);

module.exports = router;