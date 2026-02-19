const { neon } = require('@neondatabase/serverless');

function getDb() {
  const sql = neon(process.env.DATABASE_URL);
  return sql;
}

function parseJsonField(val) {
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return val; }
  }
  return val;
}

function formatInvention(row) {
  const r = { ...row };
  for (const field of ['claims', 'categories', 'prior_art', 'inventors', 'attachments', 'metadata']) {
    if (r[field]) r[field] = parseJsonField(r[field]);
  }
  return r;
}

module.exports = { getDb, formatInvention };
