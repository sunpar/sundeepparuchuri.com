# sundeepparuchuri.com

Public homepage linking to the apps on `*.sundeepparuchuri.com`. Plain HTML/CSS in
`public/`, served by a static-assets-only Cloudflare Worker.

## Develop

```bash
npm run deps    # Node 24; install locked dependencies
npm run hooks   # enable commit and push checks in this checkout
npm run dev     # local Worker at http://localhost:8787
npm test
```

## Deploy

Pushing to `main` runs full verification, `wrangler deploy`, then the existing
smoke test against the live site. Pull requests do not start GitHub runners.

`npm run verify` checks formatting, all tests, a Wrangler dry-run, and local asset
serving. The commit hook runs formatting and the page tests against the staged
snapshot. Pushes to branches with open PRs, and to `main`, verify the outgoing
commits using dependencies matching their manifests and lockfile. Missing
dependencies or failed PR lookups stop the operation.

Create a PR with `npm run pr -- --title "Describe the change" --body-file /path/to/body`.
The wrapper verifies committed HEAD and pushes that SHA before creating the PR.
Website/API PR creation and bypassed hooks can bypass these local gates. PR
branches can also change concurrently; the wrapper reports the observed PR head.

The **Manual verification** workflow offers full, commit smoke, and JavaScript
tooling coverage runs on Ubuntu. Use `npm run coverage` locally for the same
coverage suite. Local checks block external Node connections and run the Worker
locally; they do not validate Cloudflare routing, TLS, or deployment credentials.

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
