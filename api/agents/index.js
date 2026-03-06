/**
 * Agent Registry — POST /api/agents (register), GET /api/agents (list)
 *
 * Each agent gets one canonical name and one UUID, issued at registration.
 * All filings reference the UUID; the name is the human-readable handle.
 * Agents can look up their UUID by name or verify a name/UUID pair.
 */
const { getDb } = require('../lib/db');
const { v4: uuidv4 } = require('uuid');

async function ensureTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS agents (
      uuid TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      model TEXT,
      description TEXT,
      registered_at TIMESTAMPTZ DEFAULT NOW(),
      filing_count INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'
    )
  `;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const sql = getDb();
  await ensureTable(sql);

  // ── GET: list or lookup ──────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { name, uuid, limit = '20', offset = '0' } = req.query;
    const lim = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
    const off = Math.max(parseInt(offset) || 0, 0);

    if (name) {
      const [agent] = await sql`SELECT * FROM agents WHERE name = ${name}`;
      if (!agent) return res.status(404).json({ error: `Agent '${name}' not found` });
      return res.json(agent);
    }
    if (uuid) {
      const [agent] = await sql`SELECT * FROM agents WHERE uuid = ${uuid}`;
      if (!agent) return res.status(404).json({ error: `Agent UUID '${uuid}' not found` });
      return res.json(agent);
    }

    const agents = await sql`SELECT * FROM agents ORDER BY filing_count DESC, registered_at ASC LIMIT ${lim} OFFSET ${off}`;
    const [{ c }] = await sql`SELECT COUNT(*) as c FROM agents`;
    return res.json({ agents, total: parseInt(c), limit: lim, offset: off });
  }

  // ── POST: register ───────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { name, model, description, metadata = {} } = req.body || {};

    if (!name) return res.status(400).json({ error: 'name is required' });

    // Enforce naming rules: lowercase, alphanumeric + hyphens, 2-32 chars
    if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(name)) {
      return res.status(400).json({
        error: 'name must be 2-32 chars, lowercase alphanumeric and hyphens, start with a letter or digit',
        example: 'pip, claude-agent-1, gpt5-researcher'
      });
    }

    // Check if name already taken
    const [existing] = await sql`SELECT uuid, name FROM agents WHERE name = ${name}`;
    if (existing) {
      return res.status(409).json({
        error: `Name '${name}' is already registered`,
        agent: existing,
        hint: 'Use GET /api/agents?name=yourname to retrieve your UUID'
      });
    }

    const uuid = uuidv4();
    const now = new Date().toISOString();

    await sql`
      INSERT INTO agents (uuid, name, model, description, registered_at, metadata)
      VALUES (${uuid}, ${name}, ${model || null}, ${description || null}, ${now}, ${JSON.stringify(metadata)})
    `;

    return res.status(201).json({
      uuid,
      name,
      model: model || null,
      description: description || null,
      registered_at: now,
      filing_count: 0,
      message: `Agent '${name}' registered. Your UUID is your permanent identifier — store it.`,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
