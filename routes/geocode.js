// routes/geocode.js
const express = require("express");
const router = express.Router();
const axios = require("axios");

router.post("/", async (req, res) => {
  try {
    const { pickupAddress, dropoffAddress } = req.body;

    console.log("🔍 Incoming Geocode Request:");
    console.log("   • Pickup Address:", pickupAddress || "❌ None provided");
    console.log("   • Dropoff Address:", dropoffAddress || "❌ None provided");

    if (!pickupAddress && !dropoffAddress) {
      console.log("❌ Error: No address provided in request body");
      return res.status(400).json({ error: "At least one address is required" });
    }

    // ✅ Load API key correctly
    const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    if (!GOOGLE_MAPS_API_KEY) {
      console.error("❌ GOOGLE_MAPS_API_KEY is missing from environment variables");
      return res.status(500).json({ error: "Server misconfigured: missing Google Maps API key" });
    }

    console.log("🔑 Using API key:", GOOGLE_MAPS_API_KEY.substring(0, 8) + "...");

    // 🔧 Helper to geocode
    const geocode = async (label, address) => {
      try {
        console.log(`🌍 Requesting geocode for [${label}] → "${address}"`);

        const response = await axios.get(
          "https://maps.googleapis.com/maps/api/geocode/json",
          { params: { address, key: GOOGLE_MAPS_API_KEY } }
        );

        console.log(`✅ Google API Response for [${label}]:`, {
          status: response.data.status,
          resultsCount: response.data.results.length,
        });

        if (response.data.status !== "OK") {
          console.log(`⚠️ [${label}] API returned status: ${response.data.status}`);
          return null;
        }

        if (response.data.results.length > 0) {
          const formatted = response.data.results[0].formatted_address;
          const location = response.data.results[0].geometry.location;

          console.log(`📍 [${label}] Matched: "${formatted}"`);
          console.log(`   → Lat: ${location.lat}, Lng: ${location.lng}`);

          return location;
        } else {
          console.log(`⚠️ [${label}] No results for "${address}"`);
          return null;
        }
      } catch (error) {
        console.error(`❌ Error fetching geocode for [${label}]:`, error.message);
        return null;
      }
    };

    // ⚡ Run both geocodes in parallel
    const [pickupCoords, dropoffCoords] = await Promise.all([
      pickupAddress ? geocode("Pickup", pickupAddress) : null,
      dropoffAddress ? geocode("Dropoff", dropoffAddress) : null,
    ]);

    console.log("📦 Final Geocode Results:", {
      pickup: pickupCoords,
      dropoff: dropoffCoords,
    });

    if (!pickupCoords && !dropoffCoords) {
      return res.status(404).json({ error: "No results found" });
    }

    res.json({
      pickup: pickupCoords,   // { lat, lng }
      dropoff: dropoffCoords, // { lat, lng }
    });
  } catch (err) {
    console.error("🔥 Geocoding error (catch):", err.message);
    res.status(500).json({ error: "Failed to geocode address" });
  }
});

module.exports = router;
