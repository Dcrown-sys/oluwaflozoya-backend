const postgres = require('postgres');
require('dotenv').config();

const sql = postgres(process.env.DATABASE_URL, {
  ssl: 'require',
  prepare: false,  // ✅ ADD THIS — fixes "cached plan must not change result type"
});

// Optional test
(async () => {
  try {
    const result = await sql`SELECT NOW()`;
    console.log('✅ Database connected:', result);
  } catch (err) {
    console.error('❌ Database connection failed:', err);
  }
})();

module.exports = { sql };