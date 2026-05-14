const { sql } = require("../db");
const {
  calculatePurchasePoints,
  calculateReferralPoints,
} = require("./engineerRewards");
const { updateEngineerRank } = require("./engineerRankSystem");
const { awardMonthlyReferralBonus } = require("./engineerMonthlyBonus");
const { evaluateEngineerBadges } = require("./engineerBadges");

async function awardEngineerPointsForOrder(orderId) {
  const [order] = await sql`
    SELECT id, user_id, total_amount, status
    FROM orders
    WHERE id = ${orderId}
    LIMIT 1
  `;

  if (!order) {
    throw new Error("Order not found");
  }

  const allowedStatuses = ["completed", "delivered"];

  if (!allowedStatuses.includes(order.status)) {
    return {
      awarded: false,
      reason: `Order status is ${order.status}. Points can only be awarded when order is completed or delivered.`,
    };
  }

  const [buyer] = await sql`
    SELECT id, full_name, role, username, referred_by_user_id
    FROM users
    WHERE id = ${order.user_id}
    LIMIT 1
  `;

  if (!buyer) {
    throw new Error("Order buyer not found");
  }

  const [engineerProfile] = await sql`
  SELECT id
  FROM engineer_profiles
  WHERE user_id = ${buyer.id}
  LIMIT 1
`;

  if (!engineerProfile) {
    return {
      awarded: false,
      reason: "Buyer does not have an engineer profile",
    };
  }

  const orderAmount = Number(order.total_amount || 0);

  if (orderAmount <= 0) {
    return {
      awarded: false,
      reason: "Order amount is invalid",
    };
  }

  const purchasePoints = await calculatePurchasePoints(orderAmount);

  const [purchaseReward] = await sql`
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
      ${buyer.id},
      ${order.id},
      'purchase',
      ${purchasePoints},
      ${purchasePoints},
      ${`Purchase reward for order ${order.id}`},
      'approved',
      NOW()
    )
    ON CONFLICT (user_id, order_id, source_type)
    DO NOTHING
    RETURNING *
  `;

  if (purchaseReward) {
    await sql`
      UPDATE engineer_profiles
      SET
        total_points = total_points + ${purchasePoints},
        available_points = available_points + ${purchasePoints},
        updated_at = NOW()
      WHERE user_id = ${buyer.id}
    `;
  }

  if (purchaseReward) {
  await updateEngineerRank(buyer.id);
}

await evaluateEngineerBadges(buyer.id);

  let referralReward = null;

  if (buyer.referred_by_user_id) {
    const referralPoints = await calculateReferralPoints(orderAmount);

    const [insertedReferralReward] = await sql`
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
        ${buyer.referred_by_user_id},
        ${order.id},
        'referral',
        ${referralPoints},
        ${referralPoints},
        ${`Referral reward from ${buyer.full_name || buyer.username}'s order`},
        'approved',
        NOW()
      )
      ON CONFLICT (user_id, order_id, source_type)
      DO NOTHING
      RETURNING *
    `;

    referralReward = insertedReferralReward || null;

    if (referralReward) {
      await sql`
    UPDATE engineer_profiles
    SET
      total_points = total_points + ${referralPoints},
      available_points = available_points + ${referralPoints},
      lifetime_referral_earnings = lifetime_referral_earnings + ${referralPoints},
      updated_at = NOW()
    WHERE user_id = ${buyer.referred_by_user_id}
  `;

      await sql`
    UPDATE engineer_referrals
    SET
      status = 'active',
      first_purchase_order_id = COALESCE(first_purchase_order_id, ${order.id})
    WHERE referred_user_id = ${buyer.id}
      AND referrer_user_id = ${buyer.referred_by_user_id}
  `;

      await updateEngineerRank(buyer.referred_by_user_id);
      await awardMonthlyReferralBonus(buyer.referred_by_user_id);
      await evaluateEngineerBadges(buyer.referred_by_user_id);
    }
  }

  return {
    awarded: true,
    order_id: order.id,
    buyer_id: buyer.id,
    purchase_reward: purchaseReward || null,
    referral_reward: referralReward,
  };
}

module.exports = {
  awardEngineerPointsForOrder,
};
