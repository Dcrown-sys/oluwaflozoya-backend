const { sql } = require("../db");

function getMonthlyBonusPoints(rank) {
  switch (rank) {
    case "Diamond":
      return 100000;
    case "Platinum":
      return 40000;
    case "Gold":
      return 15000;
    case "Silver":
      return 5000;
    default:
      return 0;
  }
}

async function awardMonthlyReferralBonus(userId) {
  const [profile] = await sql`
    SELECT rank, monthly_referral_target
    FROM engineer_profiles
    WHERE user_id = ${userId}
    LIMIT 1
  `;

  if (!profile) return null;

  const monthKey = new Date().toISOString().slice(0, 7);

  const [stats] = await sql`
    SELECT COUNT(*) AS active_referrals_this_month
    FROM engineer_referrals
    WHERE referrer_user_id = ${userId}
      AND status = 'active'
      AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())
  `;

  const referralsCount = Number(stats.active_referrals_this_month || 0);
  const target = Number(profile.monthly_referral_target || 0);

  if (target <= 0 || referralsCount < target) {
    return {
      awarded: false,
      reason: "Monthly referral target not reached",
      referralsCount,
      target,
    };
  }

  const bonusPoints = getMonthlyBonusPoints(profile.rank);

  if (bonusPoints <= 0) {
    return {
      awarded: false,
      reason: "No bonus for current rank",
      rank: profile.rank,
    };
  }

  const [bonus] = await sql`
    INSERT INTO engineer_monthly_bonuses (
      user_id,
      month_key,
      bonus_points,
      rank_at_bonus,
      referrals_count,
      created_at
    )
    VALUES (
      ${userId},
      ${monthKey},
      ${bonusPoints},
      ${profile.rank},
      ${referralsCount},
      NOW()
    )
    ON CONFLICT (user_id, month_key)
    DO NOTHING
    RETURNING *
  `;

  if (!bonus) {
    return {
      awarded: false,
      reason: "Monthly bonus already awarded",
      monthKey,
    };
  }

  await sql`
    INSERT INTO engineer_points (
      user_id,
      order_id,
      source_type,
      points,
      amount_value,
      description,
      status,
      created_at
    )
    VALUES (
      ${userId},
      NULL,
      'bonus',
      ${bonusPoints},
      ${bonusPoints},
      ${`Monthly referral target bonus for ${monthKey}`},
      'approved',
      NOW()
    )
  `;

  await sql`
    UPDATE engineer_profiles
    SET
      total_points = total_points + ${bonusPoints},
      available_points = available_points + ${bonusPoints},
      monthly_bonus_points = monthly_bonus_points + ${bonusPoints},
      updated_at = NOW()
    WHERE user_id = ${userId}
  `;

  return {
    awarded: true,
    bonus,
  };
}

module.exports = {
  awardMonthlyReferralBonus,
  getMonthlyBonusPoints,
};