module.exports = async function handler(req, res) {
  const key = process.env.OPENROUTER_API_KEY;
  return res.json({ 
    has_key: !!key,
    key_prefix: key ? key.substring(0, 12) + '...' : 'missing'
  });
};
