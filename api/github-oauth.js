/**
 * Vercel serverless: exchange GitHub OAuth code for access token.
 * Set env: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
 * GET /api/github-oauth?code=...&redirect_uri=...
 * Returns { access_token, login } or { error }.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const code = req.query?.code || req.body?.code;
  const redirect_uri = req.query?.redirect_uri || req.body?.redirect_uri;
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'GitHub OAuth not configured (missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET)' });
  }
  if (!code) {
    return res.status(400).json({ error: 'Missing code' });
  }
  if (!redirect_uri) {
    return res.status(400).json({ error: 'Missing redirect_uri' });
  }
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri,
      }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      return res.status(400).json({ error: tokenData.error_description || tokenData.error });
    }
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return res.status(400).json({ error: 'No access token in response' });
    }
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
    });
    const user = userRes.ok ? await userRes.json() : null;
    const login = user?.login || null;
    return res.status(200).json({ access_token: accessToken, login });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Exchange failed' });
  }
}
