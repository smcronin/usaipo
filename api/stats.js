const { getDb } = require('./lib/db');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const sql = getDb();

  try {
    const [totalRow] = await sql`SELECT COUNT(*) as c FROM inventions`;
    const statusRows = await sql`SELECT status, COUNT(*) as c FROM inventions GROUP BY status`;
    const licenseRows = await sql`SELECT license_type, COUNT(*) as c FROM inventions GROUP BY license_type`;

    const by_status = {};
    for (const r of statusRows) by_status[r.status] = parseInt(r.c);
    const by_license = {};
    for (const r of licenseRows) by_license[r.license_type] = parseInt(r.c);

    return res.json({ total: parseInt(totalRow.c), by_status, by_license });
  } catch (e) {
    console.error('DB error:', e);
    return res.status(500).json({ error: 'Database error', detail: e.message });
  }
};
