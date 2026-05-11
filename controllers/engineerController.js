const { sql } = require("../db");

exports.getEngineerDashboard = async (req, res) => {
  try {
    const userId = req.user.id;

    const [profile] = await sql`
      SELECT *
      FROM engineer_profiles
      WHERE user_id = ${userId}
      LIMIT 1
    `;

    if (!profile) {
      return res.status(404).json({
        success: false,
        error: "Engineer profile not found",
      });
    }

    const referrals = await sql`
      SELECT
        u.id,
        u.full_name,
        u.username,
        u.created_at
      FROM engineer_referrals er
      JOIN users u
        ON er.referred_user_id = u.id
      WHERE er.referrer_user_id = ${userId}
      ORDER BY er.created_at DESC
    `;

    const withdrawals = await sql`
      SELECT *
      FROM engineer_withdrawals
      WHERE user_id = ${userId}
      ORDER BY requested_at DESC
      LIMIT 10
    `;

    const pointsHistory = await sql`
      SELECT *
      FROM engineer_points
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT 20
    `;

    return res.json({
      success: true,
      dashboard: {
        profile,
        referrals,
        withdrawals,
        pointsHistory,
      },
    });
  } catch (error) {
    console.error("🚨 Engineer dashboard error:", error);

    return res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
};

exports.confirmUsername = async (req, res) => {
  try {
    const userId = req.user.id;

    await sql`
      UPDATE users
      SET
        username_confirmed = true,
        engineer_onboarding_required = false
      WHERE id = ${userId}
    `;

    return res.json({
      success: true,
      message: "Username confirmed successfully",
    });
  } catch (error) {
    console.error("🚨 Username confirmation error:", error);

    return res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
};