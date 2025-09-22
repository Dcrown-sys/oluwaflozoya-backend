const { sql } = require('../db');

const getAdminOverview = async (req, res) => {
  try {
    const monthlyDays = parseInt(req.query.monthlyDays) || 30;
    const weeklyDays = parseInt(req.query.weeklyDays) || 7;

    // User counts per role
    const userCounts = await sql`
      SELECT role, COUNT(*) as count
      FROM users
      GROUP BY role
    `;
    console.log('📊 Raw userCounts from DB:', userCounts);
    const userCountMap = Object.fromEntries(
        userCounts.map(u => [u.role, Number(u.count)])
      );
      console.log('✅ Parsed userCountMap:', userCountMap);

   


    // Total orders count
    const totalOrders = await sql`SELECT COUNT(*) FROM orders`;

    // Order counts by status
    const orderStatusCounts = await sql`
      SELECT status, COUNT(*) as count
      FROM orders
      GROUP BY status
    `;
    const orderStatusMap = {};
    orderStatusCounts.forEach(s => {
      orderStatusMap[s.status] = Number(s.count);
    });

    // Monthly revenue
    const monthlyRevenueResult = await sql`
      SELECT COALESCE(SUM(amount), 0) AS revenue
      FROM payments
      WHERE created_at >= NOW() - INTERVAL '${monthlyDays} days'
    `;

    // Weekly revenue comparison
    const lastWeekRevenueResult = await sql`
      SELECT COALESCE(SUM(amount), 0) AS revenue
      FROM payments
      WHERE created_at BETWEEN NOW() - INTERVAL '${2 * weeklyDays} days' AND NOW() - INTERVAL '${weeklyDays} days'
    `;

    const thisWeekRevenueResult = await sql`
      SELECT COALESCE(SUM(amount), 0) AS revenue
      FROM payments
      WHERE created_at >= NOW() - INTERVAL '${weeklyDays} days'
    `;

    const lastWeekRevenue = Number(lastWeekRevenueResult[0].revenue);
    const thisWeekRevenue = Number(thisWeekRevenueResult[0].revenue);

    let weeklyGrowthPercent = null;
    if (lastWeekRevenue > 0) {
      weeklyGrowthPercent = ((thisWeekRevenue - lastWeekRevenue) / lastWeekRevenue) * 100;
    }

    // Low stock products
    const lowStockProducts = await sql`
      SELECT id, name, min_order_qty, price, stock
      FROM products
      WHERE stock IS NOT NULL AND stock < min_order_qty
      ORDER BY stock ASC
      LIMIT 10
    `;

    // User growth (last 30 days)
    const userGrowth = await sql`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM users
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at)
    `;

    // Conversion rate
    const totalUsersForConversion = (userCountMap.buyer || 0) + (userCountMap.courier || 0);
    const usersWhoOrderedResult = await sql`
      SELECT COUNT(DISTINCT user_id) AS count FROM orders
    `;
    const usersWhoOrdered = Number(usersWhoOrderedResult[0].count);
    const conversionRate = totalUsersForConversion > 0
      ? (usersWhoOrdered / totalUsersForConversion) * 100
      : null;

    // Top 5 products
    const topProductsRaw = await sql`
      SELECT p.id, p.name, SUM(oi.quantity) AS orders
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      GROUP BY p.id, p.name
      ORDER BY orders DESC
      LIMIT 5
    `;
    const topProducts = topProductsRaw.map(p => ({
      id: p.id,
      name: p.name,
      orders: Number(p.orders),
    }));
    console.log('🧩 userCountMap keys:', Object.keys(userCountMap));

    res.json({
        users: {
            total: Object.values(userCountMap).reduce((sum, val) => sum + val, 0),
            admins: userCountMap['admin'] || 0,
            producers: userCountMap['producer'] || 0,
            buyers: userCountMap['buyer'] || 0,
            couriers: userCountMap['courier'] || 0,
          },
      orders: {
        total: Number(totalOrders[0].count),
        pending: orderStatusMap.pending || 0,
        en_route: orderStatusMap.en_route || 0,
        delivered: orderStatusMap.delivered || 0,
      },
      revenue: {
        monthly: Number(monthlyRevenueResult[0].revenue),
        weeklyGrowthPercent: weeklyGrowthPercent !== null ? parseFloat(weeklyGrowthPercent.toFixed(2)) : null,
      },
      stockAlerts: lowStockProducts,
      userGrowth: userGrowth.map(u => ({
        date: u.date.toISOString().slice(0, 10),
        count: Number(u.count),
      })),
      conversionRate: conversionRate !== null ? parseFloat(conversionRate.toFixed(2)) : null,
      topProducts,
    });

  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ message: 'Failed to fetch analytics' });
  }
};

module.exports = {
  getAdminOverview
};
