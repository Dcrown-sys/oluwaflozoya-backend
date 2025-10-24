const express = require("express");
const router = express.Router();
const { sql } = require("../db");

router.get("/verified", async (req, res) => {
  try {
    const couriers = await sql`
      SELECT 
        id,
        full_name,
        phone,
        vehicle_type,
        vehicle_plate,
        verification_status,
        availability
      FROM couriers
      ORDER BY full_name ASC
    `;

    res.status(200).json({
      success: true,
      count: couriers.length,
      data: couriers,
    });
  } catch (err) {
    console.error("❌ Error fetching couriers:", err.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch couriers",
    });
  }
});


module.exports = router;
