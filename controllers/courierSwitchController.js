// controllers/courierController.js
const { sql } = require('../db');

exports.updateAvailability = async (req, res) => {
  const courierId = req.user?.id; // from JWT
  const { availability } = req.body;

  if (!courierId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  if (!['Online', 'Offline', 'Busy'].includes(availability)) {
    return res.status(400).json({ success: false, message: 'Invalid availability value' });
  }

  try {
    const [updatedCourier] = await sql`
      UPDATE couriers
      SET availability = ${availability}
      WHERE id = ${courierId}
      RETURNING id, full_name, availability;
    `;

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
