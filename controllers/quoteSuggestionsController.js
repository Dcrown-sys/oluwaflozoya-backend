// controllers/quoteSuggestionsController.js
const { sql } = require('../db');

exports.search = async (req, res, next) => {
  try {
    const { q, limit } = req.query;
    const like = `%${q}%`;
    const items = await sql`
      SELECT 'category' AS type, id::text AS id, name,
             NULL::text AS unit, NULL::text AS image_url
      FROM categories
      WHERE name ILIKE ${like}
      UNION ALL
      SELECT 'product' AS type, id::text AS id, name,
             unit::text AS unit, image_url::text AS image_url
      FROM products
      WHERE name ILIKE ${like}
      ORDER BY type, name
      LIMIT ${limit};
    `;
    res.json({ success: true, items });
  } catch (err) { next(err); }
};