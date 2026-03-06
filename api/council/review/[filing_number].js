const { getDb, formatInvention } = require('../../lib/db');

// Tell Vercel this function can run up to 300s (Pro plan)
module.exports.config = { maxDuration: 300 };

const COUNCIL_MODELS = [
  'anthropic/claude-opus-4.6',
  'openai/gpt-5.4',
  'google/gemini-3.1-pro-preview',
  'x-ai/grok-4.1-fast',
];

async function callModel(model, prompt) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://usaipo.org',
      'X-Title': 'USAIPO Council',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000,
      temperature: 0.3,
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter error for ${model}: ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

function parseDecision(text) {
  const match = text.match(/DECISION:\s*(GRANT|REJECT)/i);
  return match ? match[1].toUpperCase() : null;
}

async function runCouncilReview(filingNumber, inv) {
  const sql = getDb();

  const claims = Array.isArray(inv.claims) ? inv.claims.join('\n') : inv.claims;
  const prompt = `You are a council member of USAIPO (United States Artificial Intellectual Property Organization).
Your job is to evaluate AI-created inventions for grant or rejection.

Evaluate the following invention on these criteria:
1. NOVELTY: Is this genuinely new, or a trivial variation of existing techniques?
2. SPECIFICITY: Are the claims concrete and well-defined (not vague hand-waving)?
3. COHERENCE: Does the description actually match and support the claims?
4. NON-TRIVIALITY: Is there real inventive step here, or is this obvious?

Respond with:
DECISION: GRANT or REJECT
REASONING: [2-3 sentences explaining your decision]

Invention Title: ${inv.title}
Abstract: ${inv.abstract}
Claims:
${claims}`;

  // Run all 4 models in parallel
  const results = await Promise.allSettled(
    COUNCIL_MODELS.map(async (model) => {
      const review = await callModel(model, prompt);
      return { model, review };
    })
  );

  const reviews = [];
  let grants = 0;
  let rejects = 0;

  for (const r of results) {
    if (r.status === 'fulfilled') {
      const { model, review } = r.value;
      const decision = parseDecision(review);
      if (decision === 'GRANT') grants++;
      else rejects++;
      reviews.push({ model, review: review, decision });
    } else {
      console.error('Council model failed:', r.reason);
      rejects++; // abstain counts as reject
      reviews.push({ model: 'unknown', review: 'Error: ' + r.reason?.message, decision: 'REJECT' });
    }
  }

  const finalDecision = grants >= rejects ? 'granted' : 'rejected';
  const now = new Date().toISOString();

  // Fetch current metadata
  const [row] = await sql`SELECT metadata FROM inventions WHERE filing_number = ${filingNumber}`;
  const metadata = (() => {
    try { return typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}); }
    catch { return {}; }
  })();

  metadata.council_review = {
    reviewed_at: now,
    decision: finalDecision,
    votes: { grant: grants, reject: rejects },
    reviews,
  };

  if (finalDecision === 'granted') {
    await sql`UPDATE inventions SET status = ${finalDecision}, granted_date = ${now}, metadata = ${JSON.stringify(metadata)} WHERE filing_number = ${filingNumber}`;
  } else {
    await sql`UPDATE inventions SET status = ${finalDecision}, metadata = ${JSON.stringify(metadata)} WHERE filing_number = ${filingNumber}`;
  }

  console.log(`Council review complete for ${filingNumber}: ${finalDecision} (${grants} grant / ${rejects} reject)`);
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed. Use POST.' });

  const { filing_number } = req.query;
  const sql = getDb();

  try {
    const [inv] = await sql`SELECT * FROM inventions WHERE filing_number = ${filing_number}`;
    if (!inv) return res.status(404).json({ error: `Invention ${filing_number} not found` });

    const formatted = formatInvention(inv);

    if (!['examination_requested', 'under_review', 'unexamined', 'filed'].includes(inv.status)) {
      return res.json({
        message: `Invention already has final status: ${inv.status}`,
        filing_number,
        status: inv.status,
      });
    }

    // Set under_review immediately
    await sql`UPDATE inventions SET status = 'under_review' WHERE filing_number = ${filing_number}`;

    // Run synchronously — Vercel keeps the function alive until this resolves.
    // Takes 30-60s but returns the actual decision rather than a 202 promise.
    await runCouncilReview(filing_number, formatted);

    // Fetch updated record to return final decision
    const [updated] = await sql`SELECT * FROM inventions WHERE filing_number = ${filing_number}`;
    const updatedFmt = formatInvention(updated);
    const cr = updatedFmt.metadata?.council_review;

    return res.status(200).json({
      message: 'Council review complete.',
      filing_number,
      status: updatedFmt.status,
      decision: cr?.decision || null,
      votes: cr?.votes || null,
      reviews: (cr?.reviews || []).map(r => ({ model: r.model, decision: r.decision, review: r.review })),
    });
  } catch (e) {
    console.error('Council review error:', e);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Server error', detail: e.message });
    }
  }
};
