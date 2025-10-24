// controllers/courierController.js
const { sql } = require('../db');

exports.updateAvailability = async (req, res) => {
  const courierUserId = req.user?.id; // user_id from JWT
  const { availability } = req.body;

  if (!courierUserId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // Validate input
  if (!['Online', 'Offline', 'Busy'].includes(availability)) {
    return res.status(400).json({ success: false, message: 'Invalid availability value' });
  }

  try {
    // Update using user_id instead of courier id
    const [updatedCourier] = await sql`
      UPDATE couriers
      SET availability = ${availability},
          updated_at = NOW()
      WHERE user_id = ${courierUserId}
      RETURNING id, full_name, availability;
    `;

    if (!updatedCourier) {
      return res.status(404).json({ success: false, message: 'Courier profile not found' });
    }

    res.status(200).json({
      success: true,
      message: `Availability updated to ${availability}`,
      courier: updatedCourier,
    });
  } catch (err) {
    console.error('❌ Error updating availability:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
