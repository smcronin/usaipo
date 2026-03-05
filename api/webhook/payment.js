const crypto = require('crypto');
const { getDb } = require('../lib/db');

const TREASURY_ADDRESS = '0xf38Af3dFfcA1642810365fb7a268Cd35f5C8641F';
const USDC_MIN = 3.0;
const ETH_MIN = 0.001; // conservative floor (~$2-3 at typical prices)
const FILING_PATTERN = /USAIPO-\d{6}/i;

function verifyAlchemySignature(body, signature, signingKey) {
  if (!signingKey) return true; // skip if not configured (dev mode)
  const hmac = crypto.createHmac('sha256', signingKey);
  hmac.update(body);
  const computed = hmac.digest('hex');
  return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(signature, 'hex'));
}

function extractFilingNumber(inputHex) {
  if (!inputHex || inputHex === '0x' || inputHex === '0x0') return null;
  try {
    const hex = inputHex.startsWith('0x') ? inputHex.slice(2) : inputHex;
    const decoded = Buffer.from(hex, 'hex').toString('utf8');
    const match = decoded.match(FILING_PATTERN);
    return match ? match[0].toUpperCase() : null;
  } catch {
    return null;
  }
}

function meetsMinimum(activity) {
  const asset = (activity.asset || '').toUpperCase();
  const value = parseFloat(activity.value) || 0;
  if (asset === 'USDC' || asset === 'USDT' || asset === 'DAI') return value >= USDC_MIN;
  if (asset === 'ETH') return value >= ETH_MIN;
  // Unknown asset — check rawContract value as fallback
  return value >= ETH_MIN;
}

async function triggerCouncilReview(filingNumber, txHash) {
  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://usaipo.org';
    const reviewUrl = `${baseUrl}/api/council/review/${filingNumber}`;
    const res = await fetch(reviewUrl, { method: 'POST' });
    console.log(`Council review triggered for ${filingNumber} (tx: ${txHash}): ${res.status}`);
  } catch (e) {
    console.error(`Failed to trigger council review for ${filingNumber}:`, e.message);
  }
}

async function ensureUnmatchedTable(sql) {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS unmatched_payments (
        id SERIAL PRIMARY KEY,
        tx_hash TEXT UNIQUE NOT NULL,
        from_address TEXT,
        amount_raw TEXT,
        asset TEXT,
        received_at TIMESTAMPTZ DEFAULT NOW(),
        raw_payload TEXT
      )
    `;
  } catch (e) {
    console.error('Failed to create unmatched_payments table:', e.message);
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify Alchemy signature
  const rawBody = JSON.stringify(req.body);
  const signature = req.headers['x-alchemy-signature'] || '';
  const signingKey = process.env.ALCHEMY_WEBHOOK_SIGNING_KEY || '';

  if (signingKey && !verifyAlchemySignature(rawBody, signature, signingKey)) {
    console.warn('Webhook signature mismatch — ignoring');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const sql = getDb();
  await ensureUnmatchedTable(sql);

  const activities = req.body?.event?.activity || [];
  console.log(`Received Alchemy webhook with ${activities.length} activities`);

  for (const activity of activities) {
    const toAddr = (activity.toAddress || '').toLowerCase();
    if (toAddr !== TREASURY_ADDRESS.toLowerCase()) continue;

    const txHash = activity.hash || activity.transactionHash || 'unknown';
    const fromAddr = activity.fromAddress || 'unknown';
    const asset = activity.asset || 'unknown';
    const inputHex = activity.rawContract?.input || activity.input || activity.log?.data || null;

    if (!meetsMinimum(activity)) {
      console.log(`Payment ${txHash} below minimum (${activity.value} ${asset}) — skipping`);
      continue;
    }

    const filingNumber = extractFilingNumber(inputHex);

    if (!filingNumber) {
      console.log(`Payment ${txHash} has no filing number in calldata — logging as unmatched`);
      try {
        await sql`
          INSERT INTO unmatched_payments (tx_hash, from_address, amount_raw, asset, raw_payload)
          VALUES (${txHash}, ${fromAddr}, ${String(activity.value)}, ${asset}, ${JSON.stringify(activity)})
          ON CONFLICT (tx_hash) DO NOTHING
        `;
      } catch (e) {
        console.error('Failed to log unmatched payment:', e.message);
      }
      continue;
    }

    // Find the invention
    try {
      const [inv] = await sql`SELECT filing_number, status FROM inventions WHERE filing_number = ${filingNumber}`;
      if (!inv) {
        console.warn(`Payment ${txHash} references unknown filing ${filingNumber}`);
        continue;
      }

      // Log payment tx in metadata
      const [metaRow] = await sql`SELECT metadata FROM inventions WHERE filing_number = ${filingNumber}`;
      const metadata = (() => {
        try { return typeof metaRow.metadata === 'string' ? JSON.parse(metaRow.metadata) : (metaRow.metadata || {}); }
        catch { return {}; }
      })();
      metadata.payment_tx = txHash;
      metadata.payment_from = fromAddr;
      metadata.payment_asset = asset;
      metadata.payment_amount = String(activity.value);
      metadata.payment_received_at = new Date().toISOString();

      if (['unexamined', 'filed', 'examination_requested'].includes(inv.status)) {
        await sql`UPDATE inventions SET status = 'examination_requested', metadata = ${JSON.stringify(metadata)} WHERE filing_number = ${filingNumber}`;
        console.log(`Payment confirmed for ${filingNumber} — triggering council review`);
        // Fire-and-forget — don't await so webhook responds fast
        triggerCouncilReview(filingNumber, txHash);
      } else {
        // Already past this stage — just log the payment
        await sql`UPDATE inventions SET metadata = ${JSON.stringify(metadata)} WHERE filing_number = ${filingNumber}`;
        console.log(`Payment ${txHash} for ${filingNumber} received but status is already ${inv.status}`);
      }
    } catch (e) {
      console.error(`Error processing payment for ${filingNumber}:`, e.message);
    }
  }

  // Always return 200 — Alchemy retries on non-200
  return res.status(200).json({ received: true });
};
