const { sql } = require("../db");
const { generateEngineerUsername } = require("../utils/usernameGenerator");

async function createUniqueUsername(fullName) {
  let username;
  let exists = true;

  while (exists) {
    username = generateEngineerUsername(fullName);

    const [existingUser] = await sql`
      SELECT id
      FROM users
      WHERE username = ${username}
      LIMIT 1
    `;

    exists = !!existingUser;
  }

  return username;
}

exports.onboardEngineer = async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      specialty,
      years_of_experience,
      company_name,
      location,
      referral_username,
    } = req.body;

    const [user] = await sql`
      SELECT id, full_name, email, phone, role, username, username_confirmed, referred_by_user_id
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    `;

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    let finalUsername = user.username;

    if (!finalUsername) {
      finalUsername = await createUniqueUsername(user.full_name);

      await sql`
        UPDATE users
        SET
          username = ${finalUsername},
          username_confirmed = false,
          engineer_onboarding_required = true
        WHERE id = ${userId}
      `;
    }

    let referrer = null;

    if (referral_username && !user.referred_by_user_id) {
      const [foundReferrer] = await sql`
        SELECT id, username
        FROM users
        WHERE username = ${referral_username}
        LIMIT 1
      `;

      if (!foundReferrer) {
        return res.status(400).json({
          success: false,
          error: "Invalid referral username",
        });
      }

      if (foundReferrer.id === userId) {
        return res.status(400).json({
          success: false,
          error: "You cannot refer yourself",
        });
      }

      referrer = foundReferrer;

      await sql`
        UPDATE users
        SET referred_by_user_id = ${referrer.id}
        WHERE id = ${userId}
      `;

      await sql`
        INSERT INTO engineer_referrals (
          referrer_user_id,
          referred_user_id,
          status,
          created_at
        )
        VALUES (
          ${referrer.id},
          ${userId},
          'signed_up',
          NOW()
        )
        ON CONFLICT (referrer_user_id, referred_user_id)
        DO NOTHING
      `;
    }

    const [existingProfile] = await sql`
      SELECT *
      FROM engineer_profiles
      WHERE user_id = ${userId}
      LIMIT 1
    `;

    let profile = existingProfile;

    if (!profile) {
      const [newProfile] = await sql`
        INSERT INTO engineer_profiles (
          user_id,
          specialty,
          years_of_experience,
          company_name,
          location,
          rank,
          created_at,
          updated_at
        )
        VALUES (
          ${userId},
          ${specialty || null},
          ${years_of_experience || 0},
          ${company_name || null},
          ${location || null},
          'Bronze',
          NOW(),
          NOW()
        )
        RETURNING *
      `;

      profile = newProfile;
    } else {
      const [updatedProfile] = await sql`
        UPDATE engineer_profiles
        SET
          specialty = COALESCE(${specialty || null}, specialty),
          years_of_experience = COALESCE(${years_of_experience || null}, years_of_experience),
          company_name = COALESCE(${company_name || null}, company_name),
          location = COALESCE(${location || null}, location),
          updated_at = NOW()
        WHERE user_id = ${userId}
        RETURNING *
      `;

      profile = updatedProfile;
    }

    const [updatedUser] = await sql`
  SELECT 
    id, 
    full_name, 
    email, 
    phone, 
    role, 
    username, 
    username_confirmed, 
    engineer_onboarding_required, 
    referred_by_user_id
  FROM users
  WHERE id = ${userId}
  LIMIT 1
`;

    return res.json({
      success: true,
      message: "Engineer onboarding completed",
      user: updatedUser,
      profile,
      referrer,
    });
  } catch (error) {
    console.error("🚨 Engineer onboarding error:", error);

    return res.status(500).json({
      success: false,
      error: "Server error",
      details: error.message,
    });
  }
};

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

    const [user] = await sql`
      SELECT id, full_name, email, phone, role, username, username_confirmed, engineer_onboarding_required
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    `;

    const referrals = await sql`
      SELECT
        er.id,
        er.status,
        er.created_at,
        u.id AS referred_user_id,
        u.full_name,
        u.username,
        u.email
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

    const [summary] = await sql`
      SELECT
        COALESCE(SUM(CASE WHEN source_type = 'purchase' THEN points ELSE 0 END), 0) AS purchase_points,
        COALESCE(SUM(CASE WHEN source_type = 'referral' THEN points ELSE 0 END), 0) AS referral_points,
        COALESCE(SUM(CASE WHEN source_type = 'bonus' THEN points ELSE 0 END), 0) AS bonus_points,
        COUNT(*) AS total_point_records
      FROM engineer_points
      WHERE user_id = ${userId}
    `;

    const [activeReferralStats] = await sql`
  SELECT COUNT(*) AS active_referrals
  FROM engineer_referrals
  WHERE referrer_user_id = ${userId}
    AND status = 'active'
`;

    const rankProgress = {
      current_rank: profile.rank,
      total_points: Number(profile.total_points || 0),
      active_referrals: Number(activeReferralStats.active_referrals || 0),
      next_rank:
        profile.rank === "Bronze"
          ? "Silver"
          : profile.rank === "Silver"
            ? "Gold"
            : profile.rank === "Gold"
              ? "Platinum"
              : profile.rank === "Platinum"
                ? "Diamond"
                : null,
    };

    return res.json({
      success: true,
      dashboard: {
        user,
        profile,
        summary,
        rankProgress,
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
      details: error.message,
    });
  }
};

exports.confirmUsername = async (req, res) => {
  try {
    const userId = req.user.id;

    const [user] = await sql`
      SELECT id, username
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    `;

    if (!user || !user.username) {
      return res.status(400).json({
        success: false,
        error: "No username assigned yet. Please complete onboarding first.",
      });
    }

    const [updatedUser] = await sql`
      UPDATE users
      SET
        username_confirmed = true,
        engineer_onboarding_required = false
      WHERE id = ${userId}
      RETURNING id, full_name, email, phone, role, username, username_confirmed, engineer_onboarding_required
    `;

    return res.json({
      success: true,
      message: "Username confirmed successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("🚨 Username confirmation error:", error);

    return res.status(500).json({
      success: false,
      error: "Server error",
      details: error.message,
    });
  }
};

exports.getEngineerWallet = async (req, res) => {
  try {
    const userId = req.user.id;

    const [profile] = await sql`
      SELECT 
  total_points,
  available_points,
  pending_points,
  total_withdrawn,
  rank,
  monthly_bonus_points,
  lifetime_referral_earnings,
  referral_multiplier,
  monthly_referral_target
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

    const withdrawals = await sql`
      SELECT *
      FROM engineer_withdrawals
      WHERE user_id = ${userId}
      ORDER BY requested_at DESC
    `;

    return res.json({
      success: true,
      wallet: {
        ...profile,
        withdrawals,
      },
    });
  } catch (error) {
    console.error("🚨 Engineer wallet error:", error);
    return res.status(500).json({
      success: false,
      error: "Server error",
      details: error.message,
    });
  }
};

exports.requestWithdrawal = async (req, res) => {
  try {
    const userId = req.user.id;

    const [currentUser] = await sql`
  SELECT is_flagged, flag_reason
  FROM users
  WHERE id = ${userId}
  LIMIT 1
`;

if (currentUser?.is_flagged) {
  return res.status(403).json({
    success: false,
    error: `Withdrawal blocked. Account flagged: ${currentUser.flag_reason || "Under review"}`,
  });
}

    const { amount, bank_name, account_number, account_name } = req.body;

    if (!amount || !bank_name || !account_number || !account_name) {
      return res.status(400).json({
        success: false,
        error:
          "Amount, bank name, account number, and account name are required",
      });
    }

    const [settings] = await sql`
      SELECT minimum_withdrawal_amount, point_to_naira_rate
      FROM engineer_reward_settings
      LIMIT 1
    `;

    const minimumWithdrawal = Number(
      settings?.minimum_withdrawal_amount || 10000,
    );
    const pointToNairaRate = Number(settings?.point_to_naira_rate || 1);

    if (Number(amount) < minimumWithdrawal) {
      return res.status(400).json({
        success: false,
        error: `Minimum withdrawal amount is ₦${minimumWithdrawal.toLocaleString()}`,
      });
    }

    const [profile] = await sql`
      SELECT available_points
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

    const pointsNeeded = Number(amount) / pointToNairaRate;

    if (Number(profile.available_points) < pointsNeeded) {
      return res.status(400).json({
        success: false,
        error: "Insufficient available points",
      });
    }

    const [withdrawal] = await sql`
      INSERT INTO engineer_withdrawals (
        user_id,
        amount,
        points_used,
        bank_name,
        account_number,
        account_name,
        status,
        requested_at
      )
      VALUES (
        ${userId},
        ${amount},
        ${pointsNeeded},
        ${bank_name},
        ${account_number},
        ${account_name},
        'pending',
        NOW()
      )
      RETURNING *
    `;

    await sql`
      UPDATE engineer_profiles
      SET
        available_points = available_points - ${pointsNeeded},
        pending_points = pending_points + ${pointsNeeded},
        updated_at = NOW()
      WHERE user_id = ${userId}
    `;

    return res.json({
      success: true,
      message:
        "Withdrawal request submitted successfully. Payment will be processed within 7 business days after verification.",
      withdrawal,
    });
  } catch (error) {
    console.error("🚨 Withdrawal request error:", error);
    return res.status(500).json({
      success: false,
      error: "Server error",
      details: error.message,
    });
  }
};

exports.getEngineerAnalytics = async (req, res) => {
  try {
    const userId = req.user.id;

    const monthlyPoints = await sql`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') AS month,
        COALESCE(SUM(points), 0) AS total_points
      FROM engineer_points
      WHERE user_id = ${userId}
      GROUP BY month
      ORDER BY month ASC
    `;

    const sourceBreakdown = await sql`
      SELECT
        source_type,
        COALESCE(SUM(points), 0) AS total_points
      FROM engineer_points
      WHERE user_id = ${userId}
      GROUP BY source_type
    `;

    const monthlyWithdrawals = await sql`
      SELECT
        TO_CHAR(requested_at, 'YYYY-MM') AS month,
        COALESCE(SUM(amount), 0) AS total_amount
      FROM engineer_withdrawals
      WHERE user_id = ${userId}
      GROUP BY month
      ORDER BY month ASC
    `;

    const monthlyReferrals = await sql`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') AS month,
        COUNT(*) AS total_referrals
      FROM engineer_referrals
      WHERE referrer_user_id = ${userId}
      GROUP BY month
      ORDER BY month ASC
    `;

    return res.json({
  success: true,
  analytics: {
    pointsOverTime: monthlyPoints.map((item) => ({
      month: item.month,
      points: Number(item.total_points || 0),
    })),

    earningsBySource: sourceBreakdown.map((item) => ({
      source: item.source_type,
      points: Number(item.total_points || 0),
    })),

    withdrawalsOverTime: monthlyWithdrawals.map((item) => ({
      month: item.month,
      amount: Number(item.total_amount || 0),
    })),

    referralsOverTime: monthlyReferrals.map((item) => ({
      month: item.month,
      referrals: Number(item.total_referrals || 0),
    })),
  },
});
  } catch (error) {
    console.error("🚨 Engineer analytics error:", error);

    return res.status(500).json({
      success: false,
      error: "Server error",
      details: error.message,
    });
  }
};

exports.getEngineerLeaderboard = async (req, res) => {
  try {
    const leaderboard = await sql`
      SELECT
        ep.user_id,
        u.full_name,
        u.username,
        ep.rank,
        ep.total_points,
        ep.available_points,
        COUNT(er.id) FILTER (
          WHERE er.status = 'active'
        ) AS active_referrals
      FROM engineer_profiles ep
      JOIN users u
        ON ep.user_id = u.id
      LEFT JOIN engineer_referrals er
        ON er.referrer_user_id = ep.user_id
      GROUP BY
        ep.user_id,
        u.full_name,
        u.username,
        ep.rank,
        ep.total_points,
        ep.available_points
      ORDER BY ep.total_points DESC
      LIMIT 50
    `;

    return res.json({
      success: true,
      leaderboard,
    });
  } catch (error) {
    console.error("🚨 Engineer leaderboard error:", error);

    return res.status(500).json({
      success: false,
      error: "Server error",
      details: error.message,
    });
  }
};

exports.getReferralOverview = async (req, res) => {
  try {
    const userId = req.user.id;

    const [profile] = await sql`
      SELECT
        rank,
        referral_multiplier,
        monthly_referral_target,
        lifetime_referral_earnings,
        monthly_bonus_points
      FROM engineer_profiles
      WHERE user_id = ${userId}
      LIMIT 1
    `;

    const [monthlyStats] = await sql`
      SELECT COUNT(*) AS referrals_this_month
      FROM engineer_referrals
      WHERE referrer_user_id = ${userId}
        AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())
    `;

    const [referralEarnings] = await sql`
      SELECT
        COALESCE(SUM(points), 0) AS total_referral_points
      FROM engineer_points
      WHERE user_id = ${userId}
        AND source_type = 'referral'
    `;

    const [user] = await sql`
      SELECT username
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    `;

    return res.json({
      success: true,
      referralOverview: {
        referral_link: `https://zoyasupply.com/signup?ref=${user.username}`,
        rank: profile.rank,
        referral_multiplier: profile.referral_multiplier,
        monthly_target: profile.monthly_referral_target,
        referrals_this_month: Number(monthlyStats.referrals_this_month || 0),
        target_completed:
          Number(monthlyStats.referrals_this_month || 0) >=
          Number(profile.monthly_referral_target || 0),
        lifetime_referral_earnings: profile.lifetime_referral_earnings,
        monthly_bonus_points: profile.monthly_bonus_points,
        total_referral_points: referralEarnings.total_referral_points,
      },
    });
  } catch (error) {
    console.error("🚨 Referral overview error:", error);

    return res.status(500).json({
      success: false,
      error: "Server error",
      details: error.message,
    });
  }
};



exports.getEngineerBadges = async (req, res) => {
  try {
    const userId = req.user.id;

    const badges = await sql`
      SELECT
        id,
        badge_key,
        badge_name,
        description,
        earned_at
      FROM engineer_badges
      WHERE user_id = ${userId}
      ORDER BY earned_at DESC
    `;

    return res.json({
      success: true,
      badges,
    });
  } catch (error) {
    console.error("🚨 Engineer badges error:", error);

    return res.status(500).json({
      success: false,
      error: "Server error",
      details: error.message,
    });
  }
};