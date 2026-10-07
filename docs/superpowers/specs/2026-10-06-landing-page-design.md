# sundeepparuchuri.com landing page — design

## Goal

A public homepage at `https://sundeepparuchuri.com` that introduces Sundeep and
sends visitors to the apps hosted on subdomains. Success: the bare domain and
`www` both load the page over HTTPS, every app link works, and a push to `main`
redeploys it with no manual steps.

## Constraints

- Squarespace stays the domain registrar only. DNS is already on Cloudflare
  (nameservers `amalia`/`matteo.ns.cloudflare.com`); hosting goes on Cloudflare too.
- Deploys follow the pattern in the other repos: GitHub Actions running `wrangler`
  with a `CLOUDFLARE_API_TOKEN` repo secret and account ID
  `25f64b68ea2441b677f6788b470be590`.
- Existing subdomain records (`until`, `ridgewoodtax`, `wm`, `wm-api`) are not touched.

## Page content

- Heading: Sundeep Paruchuri.
- Link to `https://github.com/sunpar`. No bio, LinkedIn, or email.
- Three app cards, each with a name, a one-line description, and a link:

| App            | URL                                         | Description                                | Label                      |
| -------------- | ------------------------------------------- | ------------------------------------------ | -------------------------- |
| Until          | `https://until.sundeepparuchuri.com`        | Household routines and reminders           | Private · sign-in required |
| Ridgewood      | `https://ridgewoodtax.sundeepparuchuri.com` | Municipal finance for Ridgewood, NJ        | Private · sign-in required |
| Wealth Manager | `https://wm.sundeepparuchuri.com`           | Portfolio, net worth, and spending tracker | none                       |

`wm-api` is a backend and is not listed.

The page is plain HTML and CSS with no JavaScript. It is responsive down to
phone width and follows the system light/dark preference.

## Architecture

A Cloudflare Worker that serves only static files (Workers static assets, no
Worker script). Plain HTML on Pages was the alternative; Workers was chosen
because the custom domain lives in `wrangler.jsonc` instead of the dashboard.

```
public/index.html
public/styles.css
public/favicon.svg
wrangler.jsonc
package.json            pins wrangler as a devDependency
.github/workflows/deploy.yml
README.md
```

`wrangler.jsonc`:

- `name`: `sundeepparuchuri-com`
- `assets.directory`: `./public`
- `routes`: `[{ "pattern": "sundeepparuchuri.com", "custom_domain": true }]`

Wrangler creates the apex DNS record and certificate on the first deploy. The
apex currently has no record, so there is nothing to conflict with.

## Deploy pipeline

`.github/workflows/deploy.yml`:

- On pull requests to `main`: `npm ci`, then `wrangler deploy --dry-run`.
- On push to `main`: `npm ci`, `wrangler deploy`, then a smoke test that
  `curl`s `https://sundeepparuchuri.com/` and fails unless it returns 200 and the
  body contains `Sundeep Paruchuri`.

## One-time manual setup (documented in README)

1. Create the GitHub repo `sunpar/sundeepparuchuri.com` (public).
2. Create a Cloudflare API token from the "Edit Cloudflare Workers" template,
   scoped to the account and the `sundeepparuchuri.com` zone; save it as the
   repo secret `CLOUDFLARE_API_TOKEN`.
3. Done 2026-10-06: the `www` CNAME (previously pointing at the nonexistent
   `wmanager.sundeepparuchuri.com`) now targets `sundeepparuchuri.com`, proxied.
4. Done 2026-10-06: Redirect Rule "Redirect www to apex":
   `*://www.sundeepparuchuri.com/*` → `https://sundeepparuchuri.com/${2}`, 301,
   preserving the query string.

## Testing

- CI dry-run catches invalid `wrangler.jsonc` before merge.
- Post-deploy smoke test confirms the live page is served.
- Manual check after first deploy: apex and `www` load over HTTPS, `www`
  redirects to the apex, all three app links open, layout holds at phone width
  and in dark mode.

## Out of scope

Bio, blog, analytics, contact form, and generating the app list from data.
