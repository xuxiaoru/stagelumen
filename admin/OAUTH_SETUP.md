# Decap CMS GitHub OAuth Setup for Cloudflare Pages

## Why this is needed

Decap CMS uses GitHub OAuth to let editors log in. On Netlify this is built-in; on Cloudflare Pages we need a tiny OAuth proxy. The proxy lives in `functions/admin/api/` and is deployed automatically by Cloudflare Pages.

## Step 1: Create a GitHub OAuth App

1. Go to https://github.com/settings/developers
2. Click **"OAuth Apps"** → **"New OAuth App"**
3. Fill in:
   - **Application name**: `RiGeBa Lighting CMS` (or your brand)
   - **Homepage URL**: `https://www.rigebalighting.com`
   - **Authorization callback URL**: `https://www.rigebalighting.com/admin/api/callback`

   > The callback must match the domain that actually serves `/admin/api/auth`, and a
   > GitHub OAuth App accepts exactly ONE callback URL. `admin/config.yml` sets
   > `base_url: https://www.rigebalighting.com`, and Decap resolves the auth endpoint
   > against `base_url` — not against the domain the browser happens to be on. So the
   > registered callback has to be the production domain.
   - **Enable Device Flow**: leave unchecked
4. Click **"Register application"**
5. On the next page click **"Generate a new client secret"**
6. Copy both:
   - **Client ID**
   - **Client secret**

## Step 2: Add secrets to Cloudflare Pages

1. Open https://dash.cloudflare.com
2. Go to **Workers & Pages** → select your `stagelumen` project
3. Click **Settings** → **Environment variables**
4. Add two variables (use the **Production** environment):

| Variable name | Value |
|---------------|-------|
| `GITHUB_CLIENT_ID` | your Client ID from Step 1 |
| `GITHUB_CLIENT_SECRET` | your Client secret from Step 1 |

5. Click **Save**
6. Cloudflare will redeploy automatically

## Step 3: Test login

1. Open **https://www.rigebalighting.com/admin/** (not the preview domain — see the note in step 1)
2. Click **"Login with GitHub"**
3. Authorize the app
4. You should see the Decap CMS dashboard with Products / Blog Posts / Testimonials / Site Settings

## Troubleshooting

### "The page you are looking for doesn't exist"
- Make sure the Functions files exist in `functions/admin/api/` and have been pushed to GitHub.
- In Cloudflare Pages → Deployments → latest build, check that Functions were deployed.

### "GITHUB_CLIENT_ID is not set"
- Go back to Step 2 and confirm the environment variables are in the **Production** environment.

### "Invalid or expired OAuth state"
- Usually caused by pop-up blockers or third-party cookies being blocked.
- Allow pop-ups for `https://www.rigebalighting.com` and try again.

### "Be careful! The redirect_uri is not associated with this application"

This is the callback mismatch, and it is the single most common failure here. The
GitHub OAuth App rejects any `redirect_uri` that is not the one registered, and it
only accepts one.

The redirect that is actually sent is built in `functions/admin/api/auth.js`:

    const redirectUri = `${url.origin}/admin/api/callback`;

`url.origin` is the host serving `/admin/api/auth`. Because `config.yml` points
`base_url` at the production domain, Decap calls the proxy there even when the
browser is on the preview domain — so the redirect that matters is always
`https://www.rigebalighting.com/admin/api/callback`.

**Fix:** GitHub → Settings → Developer settings → OAuth Apps → *RiGeBa Lighting CMS*
→ *Authorization callback URL* → set it to exactly:

    https://www.rigebalighting.com/admin/api/callback

The one-line trap: `https://www.rigebalighting.com/admin/api/callback` and the same
URL with a trailing slash are treated as different, and the path is case-sensitive.
Copy it from the address bar of a real `/admin/api/callback` request.

If you need the callback to work on both domains, a GitHub OAuth App cannot do it —
create a second OAuth App with the other callback and point Decap at it.

## Custom domain

If you bind your own domain (e.g. `yourbrand-lighting.com`) you have two options:

1. **Use the Pages subdomain for CMS only**: keep `base_url: https://stagelumen.pages.dev` in `admin/config.yml` and set the OAuth callback to `stagelumen.pages.dev/admin/api/callback`. The public site can still be served from your custom domain.
2. **Use the custom domain everywhere**: update `admin/config.yml` `base_url` and the GitHub OAuth callback URL to your custom domain, then redeploy.
