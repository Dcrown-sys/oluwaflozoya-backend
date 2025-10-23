// routes/geocode.js
const express = require("express");
const router = express.Router();
const { geocodeAddress } = require("../utils/geocode");

// Helper to calculate traffic/time multipliers
function getTrafficMultiplier(distanceKm) {
  if (distanceKm <= 10) return 1.3; // light traffic
  if (distanceKm <= 25) return 1.6; // moderate
  return 1.8; // heavy traffic + long trip
}

function getTimeMultiplier() {
  const hour = new Date().getHours();

  // Morning rush (7–10 AM) and evening rush (5–8 PM)
  if ((hour >= 7 && hour <= 10) || (hour >= 17 && hour <= 20)) {
    return 1.3; // add 30% surcharge
  }

  // Late night deliveries (after 9 PM)
  if (hour >= 21 || hour < 5) {
    return 1.2; // slight increase for safety
  }

  return 1.0; // normal hours
}

router.post("/", async (req, res) => {
  try {
    const { pickupAddress, deliveryAddress } = req.body;

    if (!pickupAddress || !deliveryAddress) {
      return res.status(400).json({
        success: false,
        message: "Both pickup and delivery addresses are required",
      });
    }

    // Convert to coordinates
    const pickup = await geocodeAddress(pickupAddress);
    const delivery = await geocodeAddress(deliveryAddress);

    // Calculate distance using Haversine formula
    const toRad = (val) => (val * Math.PI) / 180;
    const R = 6371; // Earth's radius in km
    const dLat = toRad(delivery.lat - pickup.lat);
    const dLon = toRad(delivery.lng - pickup.lng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(pickup.lat)) *
        Math.cos(toRad(delivery.lat)) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceKm = parseFloat((R * c).toFixed(2));

    // Pricing variables
    const fuelPricePerLitre = 900; // You can pull this dynamically later
    const fuelMultiplier = 1.5;
    const perKmRate = 250;

    // Multipliers
    const trafficMultiplier = getTrafficMultiplier(distanceKm);
    const timeMultiplier = getTimeMultiplier();

    // 💰 Calculate fee
    const deliveryFee = Math.round(
      (fuelPricePerLitre * fuelMultiplier) +
      (distanceKm * perKmRate * trafficMultiplier * timeMultiplier)
    );

    res.json({
      success: true,
      message: "Distance and delivery fee calculated successfully",
      data: {
        pickup,
        delivery,
        distanceKm,
        deliveryFee,
        breakdown: {
          fuelPricePerLitre,
          fuelMultiplier,
          perKmRate,
          trafficMultiplier,
          timeMultiplier,
        },
      },
    });
  } catch (err) {
    console.error("Fee calculation error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
