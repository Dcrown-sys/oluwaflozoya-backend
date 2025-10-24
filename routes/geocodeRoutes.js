// routes/geocode.js
const express = require("express");
const router = express.Router();
const { geocodeAddress } = require("../utils/geocode");


function getTrafficMultiplier(distanceKm) {
  if (distanceKm <= 10) return 1.3; 
  if (distanceKm <= 25) return 1.6; 
  return 1.8; 
}

function getTimeMultiplier() {
  const hour = new Date().getHours();

  
  if ((hour >= 7 && hour <= 10) || (hour >= 17 && hour <= 20)) {
    return 1.3; 
  }

  
  if (hour >= 21 || hour < 5) {
    return 1.2; 
  }

  return 1.0; 
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

    
    const pickup = await geocodeAddress(pickupAddress);
    const delivery = await geocodeAddress(deliveryAddress);

    
    const toRad = (val) => (val * Math.PI) / 180;
    const R = 6371; 
    const dLat = toRad(delivery.lat - pickup.lat);
    const dLon = toRad(delivery.lng - pickup.lng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(pickup.lat)) *
        Math.cos(toRad(delivery.lat)) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceKm = parseFloat((R * c).toFixed(2));

    
    const fuelPricePerLitre = 900; 
    const fuelMultiplier = 1.5;
    const perKmRate = 250;

  
    const trafficMultiplier = getTrafficMultiplier(distanceKm);
    const timeMultiplier = getTimeMultiplier();

   
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
