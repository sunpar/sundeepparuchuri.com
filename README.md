# sundeepparuchuri.com

Public homepage linking to the apps on `*.sundeepparuchuri.com`. Plain HTML/CSS in
`public/`, served by a static-assets-only Cloudflare Worker.

## Develop

```bash
npm install
npm run dev     # http://localhost:8787
npm test
```

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`: format check, tests,
`wrangler deploy`, then a smoke test against the live site. Pull requests run
everything except the deploy.

To add an app:

1. Add an `<li>` card to `public/index.html`, with an `app--<name>` class.
2. Add its illustration to `public/img/` and its tile colour to
   `public/styles.css` (a `--<name>` token and an `.app--<name>` rule).
3. In `test/page.test.mjs`, add the app to the expected links, the
   name-and-description list and the illustration list.

## One-time Cloudflare setup

The domain is registered at Squarespace; DNS and hosting are on Cloudflare.

1. Create an API token from the **Edit Cloudflare Workers** template, scoped to
   this account and the `sundeepparuchuri.com` zone. Save it as the repo secret
   `CLOUDFLARE_API_TOKEN`.
2. The first deploy creates the apex DNS record and certificate.
3. `www`: a proxied CNAME to `sundeepparuchuri.com` plus the Redirect Rule
   "Redirect www to apex": `*://www.sundeepparuchuri.com/*` →
   `https://sundeepparuchuri.com/${2}` (301, query string preserved).
