module.exports = (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed.' });
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.TURNSTILE_SITE_KEY) return res.status(503).json({ message: 'Human verification is unavailable.' });
  return res.status(200).json({ siteKey: process.env.TURNSTILE_SITE_KEY });
};
