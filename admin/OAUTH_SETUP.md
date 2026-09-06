# Decap CMS GitHub OAuth Setup for Cloudflare Pages

## Why this is needed

Decap CMS uses GitHub OAuth to let editors log in. On Netlify this is built-in; on Cloudflare Pages we need a tiny OAuth proxy. The proxy lives in `functions/admin/api/` and is deployed automatically by Cloudflare Pages.

## Step 1: Create a GitHub OAuth App

1. Go to https://github.com/settings/developers
2. Click **"OAuth Apps"** → **"New OAuth App"**
3. Fill in:
   - **Application name**: `StageLumen CMS` (or your brand)
   - **Homepage URL**: `https://stagelumen.pages.dev`
   - **Authorization callback URL**: `https://stagelumen.pages.dev/admin/api/callback`
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

1. Open https://stagelumen.pages.dev/admin/
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
- Allow pop-ups for `stagelumen.pages.dev` and try again.

### Callback mismatch error from GitHub
- The **Authorization callback URL** in the GitHub OAuth App must exactly match `https://stagelumen.pages.dev/admin/api/callback`.
- If you later add a custom domain, create a second OAuth App (or update the callback URL) for that domain.

## Custom domain

If you bind your own domain (e.g. `yourbrand-lighting.com`) you have two options:

1. **Use the Pages subdomain for CMS only**: keep `base_url: https://stagelumen.pages.dev` in `admin/config.yml` and set the OAuth callback to `stagelumen.pages.dev/admin/api/callback`. The public site can still be served from your custom domain.
2. **Use the custom domain everywhere**: update `admin/config.yml` `base_url` and the GitHub OAuth callback URL to your custom domain, then redeploy.
