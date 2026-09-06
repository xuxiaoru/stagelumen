/**
 * Decap CMS OAuth callback for Cloudflare Pages.
 * Exchanges GitHub code for access_token and returns it to the CMS popup.
 */

async function exchangeCode(code, clientId, clientSecret, redirectUri) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri
  });

  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub token exchange failed: ${res.status} ${text}`);
  }

  return await res.json();
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach((c) => {
    const [key, ...rest] = c.trim().split('=');
    cookies[key] = decodeURIComponent(rest.join('='));
  });
  return cookies;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const clientId = env.GITHUB_CLIENT_ID;
  const clientSecret = env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new Response('GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET environment variables must be set.', { status: 500 });
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return new Response('Missing code or state parameter.', { status: 400 });
  }

  // Verify state against cookie.
  const cookies = parseCookies(request.headers.get('Cookie'));
  const raw = cookies.oauth_state || '';
  const [storedState, origin] = raw.split(':');

  if (!storedState || storedState !== state) {
    return new Response('Invalid or expired OAuth state. Please try logging in again.', { status: 403 });
  }

  const redirectUri = `${url.origin}/admin/api/callback`;
  let tokenData;
  try {
    tokenData = await exchangeCode(code, clientId, clientSecret, redirectUri);
  } catch (err) {
    return new Response(err.message, { status: 500 });
  }

  if (!tokenData.access_token) {
    return new Response(`GitHub OAuth error: ${tokenData.error_description || tokenData.error || 'unknown'}`, { status: 500 });
  }

  // Clear the state cookie.
  const clearCookie = 'oauth_state=; Path=/admin/api/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

  // Send token back to Decap CMS opener window.
  const targetOrigin = origin || url.origin;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Login Successful — StageLumen CMS</title>
</head>
<body>
  <p>Logging you in…</p>
  <script>
    (function () {
      var token = ${JSON.stringify(tokenData.access_token)};
      var origin = ${JSON.stringify(targetOrigin)};
      if (window.opener) {
        window.opener.postMessage({ token: token, provider: 'github' }, origin);
        try { window.close(); } catch (e) {}
      } else {
        document.body.innerHTML = '<h1>Login successful</h1><p>You can close this window and return to the CMS.</p>';
      }
    })();
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Set-Cookie': clearCookie,
      'Cache-Control': 'no-store'
    }
  });
}
