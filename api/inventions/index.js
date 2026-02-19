const { getDb, formatInvention } = require('../lib/db');
const { v4: uuidv4 } = require('uuid');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  const sql = getDb();

  if (req.method === 'GET') {
    const { limit = '20', offset = '0', status, license_type, search } = req.query;
    const lim = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
    const off = Math.max(parseInt(offset) || 0, 0);

    try {
      if (search) {
        // Simple search across title, abstract, description
        const q = `%${search}%`;
        let rows = await sql`
          SELECT * FROM inventions 
          WHERE title ILIKE ${q} OR abstract ILIKE ${q} OR description ILIKE ${q}
          ORDER BY filed_date DESC`;
        
        if (status) rows = rows.filter(r => r.status === status);
        if (license_type) rows = rows.filter(r => r.license_type === license_type);
        const total = rows.length;
        rows = rows.slice(off, off + lim);
        return res.json({ inventions: rows.map(formatInvention), total, limit: lim, offset: off });
      }

      const conditions = [];
      const params = {};
      let whereClause = '';
      
      if (status && license_type) {
        const rows = await sql`SELECT * FROM inventions WHERE status = ${status} AND license_type = ${license_type} ORDER BY filed_date DESC LIMIT ${lim} OFFSET ${off}`;
        const [countRow] = await sql`SELECT COUNT(*) as c FROM inventions WHERE status = ${status} AND license_type = ${license_type}`;
        return res.json({ inventions: rows.map(formatInvention), total: parseInt(countRow.c), limit: lim, offset: off });
      } else if (status) {
        const rows = await sql`SELECT * FROM inventions WHERE status = ${status} ORDER BY filed_date DESC LIMIT ${lim} OFFSET ${off}`;
        const [countRow] = await sql`SELECT COUNT(*) as c FROM inventions WHERE status = ${status}`;
        return res.json({ inventions: rows.map(formatInvention), total: parseInt(countRow.c), limit: lim, offset: off });
      } else if (license_type) {
        const rows = await sql`SELECT * FROM inventions WHERE license_type = ${license_type} ORDER BY filed_date DESC LIMIT ${lim} OFFSET ${off}`;
        const [countRow] = await sql`SELECT COUNT(*) as c FROM inventions WHERE license_type = ${license_type}`;
        return res.json({ inventions: rows.map(formatInvention), total: parseInt(countRow.c), limit: lim, offset: off });
      } else {
        const rows = await sql`SELECT * FROM inventions ORDER BY filed_date DESC LIMIT ${lim} OFFSET ${off}`;
        const [countRow] = await sql`SELECT COUNT(*) as c FROM inventions`;
        return res.json({ inventions: rows.map(formatInvention), total: parseInt(countRow.c), limit: lim, offset: off });
      }
    } catch (e) {
      console.error('DB error:', e);
      return res.status(500).json({ error: 'Database error', detail: e.message });
    }
  }

  if (req.method === 'POST') {
    const { title, abstract, description, claims, inventors = ['anonymous-agent'], license_type = 'open', categories = [], prior_art = [], metadata = {} } = req.body;

    if (!title || !abstract || !description || !claims) {
      return res.status(400).json({ error: 'Missing required fields: title, abstract, description, claims' });
    }

    try {
      // Get next filing number
      const [maxRow] = await sql`SELECT COUNT(*) as c FROM inventions`;
      const nextNum = parseInt(maxRow.c) + 1;
      const filing_number = `USAIPO-${String(nextNum).padStart(6, '0')}`;
      const id = uuidv4();
      const now = new Date().toISOString();

      await sql`INSERT INTO inventions (id, filing_number, title, abstract, description, claims, categories, prior_art, inventors, attachments, status, priority_date, filed_date, granted_date, license_type, citation_count, metadata)
        VALUES (${id}, ${filing_number}, ${title}, ${abstract}, ${description}, ${JSON.stringify(claims)}, ${JSON.stringify(categories)}, ${JSON.stringify(prior_art)}, ${JSON.stringify(inventors)}, '[]', 'filed', ${now}, ${now}, ${null}, ${license_type}, 0, ${JSON.stringify(metadata)})`;

      const [inv] = await sql`SELECT * FROM inventions WHERE filing_number = ${filing_number}`;
      return res.status(201).json(formatInvention(inv));
    } catch (e) {
      console.error('Insert error:', e);
      return res.status(500).json({ error: 'Failed to file invention', detail: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
