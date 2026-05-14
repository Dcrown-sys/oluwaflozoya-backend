const { sql } = require("../db");

const BADGES = [
  {
    key: "first_purchase_reward",
    name: "First Reward Earned",
    description: "Earned points from your first completed purchase.",
  },
  {
    key: "first_referral",
    name: "First Referral",
    description: "Successfully referred your first engineer.",
  },
  {
    key: "five_referrals",
    name: "Network Builder",
    description: "Activated 5 successful engineer referrals.",
  },
  {
    key: "ten_referrals",
    name: "Growth Champion",
    description: "Activated 10 successful engineer referrals.",
  },
  {
    key: "silver_rank",
    name: "Silver Engineer",
    description: "Reached Silver rank on Zoya.",
  },
  {
    key: "gold_rank",
    name: "Gold Engineer",
    description: "Reached Gold rank on Zoya.",
  },
];

async function awardBadge(userId, badgeKey) {
  const badge = BADGES.find((item) => item.key === badgeKey);

  if (!badge) return null;

  const [earnedBadge] = await sql`
    INSERT INTO engineer_badges (
      user_id,
      badge_key,
      badge_name,
      description,
      earned_at
    )
    VALUES (
      ${userId},
      ${badge.key},
      ${badge.name},
      ${badge.description},
      NOW()
    )
    ON CONFLICT (user_id, badge_key)
    DO NOTHING
    RETURNING *
  `;

  return earnedBadge || null;
}

async function evaluateEngineerBadges(userId) {
  const [profile] = await sql`
    SELECT rank
    FROM engineer_profiles
    WHERE user_id = ${userId}
    LIMIT 1
  `;

  if (!profile) return [];

  const earned = [];

  const [purchasePoints] = await sql`
    SELECT COUNT(*) AS count
    FROM engineer_points
    WHERE user_id = ${userId}
      AND source_type = 'purchase'
  `;

  if (Number(purchasePoints.count || 0) >= 1) {
    const badge = await awardBadge(userId, "first_purchase_reward");
    if (badge) earned.push(badge);
  }

  const [referrals] = await sql`
    SELECT COUNT(*) AS active_referrals
    FROM engineer_referrals
    WHERE referrer_user_id = ${userId}
      AND status = 'active'
  `;

  const activeReferrals = Number(referrals.active_referrals || 0);

  if (activeReferrals >= 1) {
    const badge = await awardBadge(userId, "first_referral");
    if (badge) earned.push(badge);
  }

  if (activeReferrals >= 5) {
    const badge = await awardBadge(userId, "five_referrals");
    if (badge) earned.push(badge);
  }

  if (activeReferrals >= 10) {
    const badge = await awardBadge(userId, "ten_referrals");
    if (badge) earned.push(badge);
  }

  if (profile.rank === "Silver") {
    const badge = await awardBadge(userId, "silver_rank");
    if (badge) earned.push(badge);
  }

  if (profile.rank === "Gold") {
    const badge = await awardBadge(userId, "gold_rank");
    if (badge) earned.push(badge);
  }

  return earned;
}

module.exports = {
  awardBadge,
  evaluateEngineerBadges,
};