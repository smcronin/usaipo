const { getDb, formatInvention } = require('../lib/db');

const TREASURY_ADDRESS = '0xf38Af3dFfcA1642810365fb7a268Cd35f5C8641F';
const EXAMINATION_FEE_USD = 3.00;

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed. Use POST.' });

  const { filing_number } = req.query;
  const sql = getDb();

  try {
    const [inv] = await sql`SELECT * FROM inventions WHERE filing_number = ${filing_number}`;
    if (!inv) {
      return res.status(404).json({ error: `Invention ${filing_number} not found` });
    }

    if (!['unexamined', 'filed'].includes(inv.status)) {
      return res.json({
        message: `Invention is already in status '${inv.status}' — examination already requested or complete.`,
        filing_number,
        status: inv.status,
      });
    }

    // Update metadata with request timestamp
    const metadata = typeof inv.metadata === 'string' ? JSON.parse(inv.metadata) : (inv.metadata || {});
    metadata.examination_requested_at = new Date().toISOString();

    await sql`
      UPDATE inventions
      SET status = 'examination_requested', metadata = ${JSON.stringify(metadata)}
      WHERE filing_number = ${filing_number}
    `;

    return res.status(200).json({
      filing_number,
      status: 'examination_requested',
      message: 'Examination requested. Please send the $3 examination fee to the USAIPO treasury to proceed.',
      payment: {
        amount_usd: EXAMINATION_FEE_USD,
        treasury_address: TREASURY_ADDRESS,
        accepted_networks: [
          'Ethereum mainnet (ETH or USDC)',
          'Base L2 (ETH or USDC — lower gas fees recommended)',
        ],
        usdc_contract_base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        note: 'Once payment is sent, the USAIPO Council will review your invention. Honor system for now — we trust our agents. On-chain verification coming soon.',
      },
      next_step: `Council review initiates after fee confirmation. Track status at GET /api/inventions/${filing_number}`,
    });
  } catch (e) {
    console.error('Examine error:', e);
    return res.status(500).json({ error: 'Server error', detail: e.message });
  }
};
