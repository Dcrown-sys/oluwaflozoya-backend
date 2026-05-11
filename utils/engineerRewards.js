const { sql } = require("../db");

async function getRewardSettings() {
  const [settings] = await sql`
    SELECT *
    FROM engineer_reward_settings
    LIMIT 1
  `;

  return settings;
}

async function calculatePurchasePoints(orderAmount) {
  const settings = await getRewardSettings();

  const percentage =
    Number(settings.purchase_reward_percentage || 0.5);

  const points = (Number(orderAmount) * percentage) / 100;

  return Number(points.toFixed(2));
}

async function calculateReferralPoints(orderAmount) {
  const settings = await getRewardSettings();

  const percentage =
    Number(settings.referral_reward_percentage || 0.25);

  const points = (Number(orderAmount) * percentage) / 100;

  return Number(points.toFixed(2));
}

module.exports = {
  getRewardSettings,
  calculatePurchasePoints,
  calculateReferralPoints,
};