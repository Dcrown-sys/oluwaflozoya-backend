const { sql } = require("../db");

function calculateRank({ totalPoints, activeReferrals }) {
  const points = Number(totalPoints || 0);
  const referrals = Number(activeReferrals || 0);

  if (points >= 500000 && referrals >= 100) {
    return "Diamond";
  }

  if (points >= 150000 && referrals >= 40) {
    return "Platinum";
  }

  if (points >= 50000 && referrals >= 15) {
    return "Gold";
  }

  if (points >= 10000 && referrals >= 5) {
    return "Silver";
  }

  return "Bronze";
}

async function updateEngineerRank(userId) {
  const [profile] = await sql`
    SELECT total_points
    FROM engineer_profiles
    WHERE user_id = ${userId}
    LIMIT 1
  `;

  if (!profile) {
    return null;
  }

  const [referralStats] = await sql`
    SELECT COUNT(*) AS active_referrals
    FROM engineer_referrals
    WHERE referrer_user_id = ${userId}
      AND status = 'active'
  `;

  const newRank = calculateRank({
    totalPoints: profile.total_points,
    activeReferrals: referralStats.active_referrals,
  });

  const [updatedProfile] = await sql`
    UPDATE engineer_profiles
    SET 
      rank = ${newRank},
      updated_at = NOW()
    WHERE user_id = ${userId}
    RETURNING *
  `;

  return updatedProfile;
}

module.exports = {
  calculateRank,
  updateEngineerRank,
};