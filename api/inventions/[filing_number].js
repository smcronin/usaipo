const { getDb, formatInvention } = require('../lib/db');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { filing_number } = req.query;
  const sql = getDb();

  try {
    const [inv] = await sql`SELECT * FROM inventions WHERE filing_number = ${filing_number}`;
    if (!inv) return res.status(404).json({ detail: `Invention ${filing_number} not found` });
    return res.json(formatInvention(inv));
  } catch (e) {
    console.error('DB error:', e);
    return res.status(500).json({ error: 'Database error', detail: e.message });
  }
};
