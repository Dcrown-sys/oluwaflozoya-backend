const axios = require("axios");

const GOOGLE_MAPS_API_KEY = "AIzaSyCrZRCHQBDJZ7Kh8fFM4hvtS3KxyMt0dKA";

/**
 * Convert a human-readable address to latitude and longitude
 * @param {string} address - e.g. "1600 Amphitheatre Parkway, Mountain View, CA"
 * @returns {Promise<{ lat: number, lng: number }>}
 */
exports.geocodeAddress = async (address) => {
  if (!address || address.trim() === "") {
    throw new Error("Address is required for geocoding");
  }

  try {
    const response = await axios.get(
      "https://maps.googleapis.com/maps/api/geocode/json",
      {
        params: {
          address,
          key: GOOGLE_MAPS_API_KEY,
        },
      }
    );

    if (response.data.status === "OK") {
      const { lat, lng } = response.data.results[0].geometry.location;
      return { lat, lng };
    } else if (response.data.status === "ZERO_RESULTS") {
      throw new Error("No results found for the given address");
    } else {
      throw new Error(
        `Geocoding failed: ${response.data.status} - ${response.data.error_message || ""}`
      );
    }
  } catch (err) {
    console.error("Geocode error:", err.message);
    throw new Error("Unable to fetch coordinates, please try again later.");
  }
};
