/**
 * Decap CMS OAuth proxy for Cloudflare Pages.
 * Handles /admin/api/auth and redirects to GitHub OAuth.
 */

function randomState() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Cloudflare Pages Functions receive env vars in env object.
  const clientId = env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return new Response('GITHUB_CLIENT_ID environment variable is not set.', { status: 500 });
  }

  // Decap CMS passes site_id as the origin that opened the popup.
  const origin = url.searchParams.get('site_id') || url.origin;
  const scope = url.searchParams.get('scope') || 'repo';
  const state = randomState();

  // Store state + origin in an HttpOnly cookie so callback can verify.
  const cookieValue = `${state}:${origin}`;
  const cookie = `oauth_state=${encodeURIComponent(cookieValue)}; Path=/admin/api/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;

  const redirectUri = `${url.origin}/admin/api/callback`;
  const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
  githubAuthUrl.searchParams.set('client_id', clientId);
  githubAuthUrl.searchParams.set('redirect_uri', redirectUri);
  githubAuthUrl.searchParams.set('scope', scope);
  githubAuthUrl.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: githubAuthUrl.toString(),
      'Set-Cookie': cookie,
      'Cache-Control': 'no-store'
    }
  });
}
