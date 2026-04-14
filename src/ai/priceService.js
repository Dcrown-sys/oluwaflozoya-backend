const { sql } = require('../../db/index');

const getZoyaConstructionPrices = async (query = '') => {
  try {
    // ✅ FIXED for YOUR products table
    const result = await sql`
      SELECT 
        name, price, unit, producer, description, type
      FROM products 
      WHERE (
        LOWER(name) LIKE '%cement%' OR
        LOWER(name) LIKE '%block%' OR 
        LOWER(name) LIKE '%sand%' OR
        LOWER(name) LIKE '%gravel%' OR
        LOWER(name) LIKE '%steel%' OR
        LOWER(name) LIKE '%timber%' OR
        LOWER(name) LIKE '%rod%' OR
        LOWER(type) LIKE '%construction%' OR
        LOWER(description) LIKE '%cement%'
      )
      AND price > 0 
      AND available = true
      ORDER BY price ASC
      LIMIT 20
    `;

    const prices = {};
    result.forEach(row => {
      const key = row.name.toLowerCase().replace(/[^\w]/g, '');
      if (!prices[key] && row.price > 0) {
        prices[key] = {
          price: Number(row.price),
          unit: row.unit || 'unit',
          producer: row.producer || 'Zoya',
          type: row.type || 'construction',
          description: row.description?.substring(0, 100)
        };
      }
    });

    console.log(`✅ Found ${Object.keys(prices).length} construction materials`);

    // Fallback (if empty)
    const fallback = {
      cement: { price: 7500, unit: 'bag', producer: 'BUA/Dangote' },
      blocks: { price: 350, unit: 'piece', producer: 'Zoya Blocks' },
      sand: { price: 65000, unit: 'trip', producer: 'Sharp Sand' }
    };

    return { ...fallback, ...prices };

  } catch (error) {
    console.error('💾 Query error:', error.message);
    return fallback;
  }
};

module.exports = { getZoyaConstructionPrices };
