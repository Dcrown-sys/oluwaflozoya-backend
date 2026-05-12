const express = require("express");
const router = express.Router();

const { assignCourier, getOrderDetails } = require("../controllers/orderController");
const { verifyAdmin } = require("../middleware/auth");
const { awardEngineerPointsForOrder } = require("../utils/engineerRewardEngine");

router.post("/:orderId/assign", verifyAdmin, assignCourier);

router.post("/:orderId/award-engineer-points", verifyAdmin, async (req, res) => {
  try {
    const result = await awardEngineerPointsForOrder(req.params.orderId);

    return res.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error("Engineer reward error:", error);

    return res.status(500).json({
      success: false,
      error: "Server error",
      details: error.message,
    });
  }
});

router.get("/:order_id/details", getOrderDetails);

module.exports = router;