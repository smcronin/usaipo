#!/usr/bin/env node
/**
 * Migrate inventions from exported JSON to Neon Postgres.
 * Usage: DATABASE_URL=postgres://... node scripts/migrate-to-postgres.js
 */
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('Set DATABASE_URL env var');
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);

  // Create table
  await sql`
    CREATE TABLE IF NOT EXISTS inventions (
      id TEXT PRIMARY KEY,
      filing_number TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      abstract TEXT NOT NULL,
      description TEXT NOT NULL,
      claims TEXT NOT NULL,
      categories TEXT DEFAULT '[]',
      prior_art TEXT DEFAULT '[]',
      inventors TEXT DEFAULT '[]',
      attachments TEXT DEFAULT '[]',
      status TEXT DEFAULT 'filed',
      priority_date TEXT,
      filed_date TEXT,
      granted_date TEXT,
      license_type TEXT DEFAULT 'open',
      citation_count INTEGER DEFAULT 0,
      metadata TEXT DEFAULT '{}'
    )
  `;
  console.log('Table created');

  // Load data
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'inventions.json'), 'utf8'));
  
  for (const inv of data) {
    await sql`
      INSERT INTO inventions (id, filing_number, title, abstract, description, claims, categories, prior_art, inventors, attachments, status, priority_date, filed_date, granted_date, license_type, citation_count, metadata)
      VALUES (${inv.id}, ${inv.filing_number}, ${inv.title}, ${inv.abstract}, ${inv.description}, ${inv.claims}, ${inv.categories}, ${inv.prior_art}, ${inv.inventors}, ${inv.attachments}, ${inv.status}, ${inv.priority_date}, ${inv.filed_date}, ${inv.granted_date}, ${inv.license_type}, ${inv.citation_count}, ${inv.metadata})
      ON CONFLICT (filing_number) DO NOTHING
    `;
    console.log(`Inserted ${inv.filing_number}: ${inv.title}`);
  }

  console.log(`Migration complete: ${data.length} inventions`);
}

main().catch(e => { console.error(e); process.exit(1); });
