# sundeepparuchuri.com Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve a public homepage at `https://sundeepparuchuri.com` that links to the Until, Ridgewood, and Wealth Manager subdomain apps, deployed from GitHub to Cloudflare.

**Architecture:** Static HTML/CSS in `public/`, served by a Cloudflare Worker with static assets only (no Worker script). The apex custom domain is declared in `wrangler.jsonc`. GitHub Actions checks every PR and deploys on push to `main`.

**Tech Stack:** HTML, CSS, Cloudflare Workers static assets, wrangler 4.148.0, prettier 3.9.9, Node 24 built-in test runner (`node --test`), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-06-landing-page-design.md`

## Global Constraints

- Hosting is Cloudflare; Squarespace remains registrar only. DNS is on Cloudflare.
- Cloudflare account ID: `25f64b68ea2441b677f6788b470be590`.
- Worker name: `sundeepparuchuri-com`.
- Repo: `sunpar/sundeepparuchuri.com`, public.
- No JavaScript on the page. Responsive to phone width; follows system light/dark.
- App cards, exactly:
  - Until — `https://until.sundeepparuchuri.com` — "Household routines and reminders" — "Private · sign-in required"
  - Ridgewood — `https://ridgewoodtax.sundeepparuchuri.com` — "Municipal finance for Ridgewood, NJ" — "Private · sign-in required"
  - Wealth Manager — `https://wm.sundeepparuchuri.com` — "Portfolio, net worth, and spending tracker" — no label
- Only other link: `https://github.com/sunpar`. `wm-api` is never linked.
- Existing DNS records for `until`, `ridgewoodtax`, `wm`, `wm-api` are not touched.
- Every edited file is formatted with prettier.

## Review Focus

- Phone width (375px): cards and the heading must not cause horizontal scroll; long text wraps.
- Dark mode: text and borders must stay readable when the OS is in dark mode.
- `www.sundeepparuchuri.com/some/path?x=1` should 301 to `https://sundeepparuchuri.com/some/path?x=1`, not drop the path or query.
- Unknown paths like `/nope` should return a 404, not a 500 or the homepage.
- Keyboard users must see a visible focus ring on every link.

Phone width, dark mode, and focus are checked in Task 1 Step 6 (CSS review against the listed rules). Redirect path/query and 404 are checked in Task 3 Step 6.

---

### Task 1: Landing page and content tests

**Files:**

- Create: `package.json`, `.gitignore`, `.prettierignore`
- Create: `test/page.test.mjs`
- Create: `public/index.html`, `public/styles.css`, `public/favicon.svg`

**Interfaces:**

- Produces: `npm test` (runs `node --test`), `npm run format:check`, the `public/` directory that Task 2's `wrangler.jsonc` serves.

- [ ] **Step 1: Scaffold the package**

`package.json`:

```json
{
  "name": "sundeepparuchuri-com",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "test": "node --test",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "devDependencies": {
    "prettier": "3.9.9",
    "wrangler": "4.148.0"
  }
}
```

`.gitignore`:

```
node_modules/
.wrangler/
```

`.prettierignore`:

```
package-lock.json
```

Run: `npm install`
Expected: `package-lock.json` created, no errors.

- [ ] **Step 2: Write the failing content tests**

`test/page.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";

const html = await readFile(
  new URL("../public/index.html", import.meta.url),
  "utf8",
);

const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(([, href]) => href);
const externalLinks = hrefs.filter((href) => href.startsWith("http"));
const appCards = [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(
  ([, card]) => card,
);

const cardFor = (url) =>
  appCards.find((card) => card.includes(`href="${url}"`));

test("page is titled with Sundeep's name", () => {
  assert.match(html, /<title>Sundeep Paruchuri<\/title>/);
  assert.match(html, /<h1>Sundeep Paruchuri<\/h1>/);
});

test("links only to GitHub and the three apps", () => {
  assert.deepEqual(externalLinks.sort(), [
    "https://github.com/sunpar",
    "https://ridgewoodtax.sundeepparuchuri.com",
    "https://until.sundeepparuchuri.com",
    "https://wm.sundeepparuchuri.com",
  ]);
});

test("never links the wm-api backend", () => {
  assert.doesNotMatch(html, /wm-api/);
});

test("each app card has its name and description", () => {
  const expected = [
    [
      "https://until.sundeepparuchuri.com",
      "Until",
      "Household routines and reminders",
    ],
    [
      "https://ridgewoodtax.sundeepparuchuri.com",
      "Ridgewood",
      "Municipal finance for Ridgewood, NJ",
    ],
    [
      "https://wm.sundeepparuchuri.com",
      "Wealth Manager",
      "Portfolio, net worth, and spending tracker",
    ],
  ];
  for (const [url, name, description] of expected) {
    const card = cardFor(url);
    assert.ok(card, `missing card for ${url}`);
    assert.ok(card.includes(name), `${url} card missing name ${name}`);
    assert.ok(card.includes(description), `${url} card missing description`);
  }
});

test("only the private apps are labelled as needing sign-in", () => {
  const label = "Private · sign-in required";
  assert.ok(cardFor("https://until.sundeepparuchuri.com").includes(label));
  assert.ok(
    cardFor("https://ridgewoodtax.sundeepparuchuri.com").includes(label),
  );
  assert.ok(!cardFor("https://wm.sundeepparuchuri.com").includes(label));
});

test("page ships no JavaScript", () => {
  assert.doesNotMatch(html, /<script/i);
});

test("local assets referenced by the page exist", async () => {
  const localRefs = hrefs.filter((href) => href.startsWith("/"));
  assert.deepEqual(localRefs.sort(), ["/favicon.svg", "/styles.css"]);
  for (const ref of localRefs) {
    await access(new URL(`../public${ref}`, import.meta.url));
  }
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `ENOENT` reading `public/index.html`.

- [ ] **Step 4: Write the page**

`public/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sundeep Paruchuri</title>
    <meta name="description" content="Sundeep Paruchuri's homepage and apps." />
    <meta name="color-scheme" content="light dark" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main>
      <header>
        <h1>Sundeep Paruchuri</h1>
        <a class="profile" href="https://github.com/sunpar"
          >github.com/sunpar</a
        >
      </header>
      <section aria-labelledby="apps-heading">
        <h2 id="apps-heading">Apps</h2>
        <ul class="apps">
          <li>
            <a class="app" href="https://until.sundeepparuchuri.com">
              <span class="app-name">Until</span>
              <span class="app-description"
                >Household routines and reminders</span
              >
              <span class="app-access">Private · sign-in required</span>
            </a>
          </li>
          <li>
            <a class="app" href="https://ridgewoodtax.sundeepparuchuri.com">
              <span class="app-name">Ridgewood</span>
              <span class="app-description"
                >Municipal finance for Ridgewood, NJ</span
              >
              <span class="app-access">Private · sign-in required</span>
            </a>
          </li>
          <li>
            <a class="app" href="https://wm.sundeepparuchuri.com">
              <span class="app-name">Wealth Manager</span>
              <span class="app-description"
                >Portfolio, net worth, and spending tracker</span
              >
            </a>
          </li>
        </ul>
      </section>
    </main>
  </body>
</html>
```

`public/styles.css`:

```css
:root {
  --bg: #fafaf7;
  --surface: #ffffff;
  --text: #1c1c1a;
  --muted: #5f5f58;
  --border: #e2e1da;
  --accent: #2f5d50;
  --focus: #2f5d50;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #141413;
    --surface: #1d1d1b;
    --text: #ecebe6;
    --muted: #a3a29b;
    --border: #33332f;
    --accent: #8cc4b2;
    --focus: #8cc4b2;
  }
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family:
    system-ui,
    -apple-system,
    "Segoe UI",
    sans-serif;
  line-height: 1.5;
}

main {
  max-width: 40rem;
  margin: 0 auto;
  padding: clamp(3rem, 12vh, 7rem) 1rem 4rem;
}

h1 {
  margin: 0;
  font-size: clamp(2rem, 6vw, 2.75rem);
  letter-spacing: -0.02em;
  line-height: 1.1;
}

h2 {
  margin: 3rem 0 1rem;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

a {
  color: var(--accent);
}

a:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 3px;
  border-radius: 6px;
}

.profile {
  display: inline-block;
  margin-top: 0.75rem;
}

.apps {
  display: grid;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.app {
  display: grid;
  gap: 0.25rem;
  padding: 1rem 1.25rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  text-decoration: none;
  overflow-wrap: anywhere;
  transition: border-color 120ms ease;
}

.app:hover {
  border-color: var(--accent);
}

.app-name {
  font-weight: 600;
}

.app-description {
  color: var(--muted);
}

.app-access {
  font-size: 0.8rem;
  color: var(--muted);
}
```

`public/favicon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#2f5d50" />
  <text x="16" y="21.5" font-family="system-ui, sans-serif" font-size="14" font-weight="700" fill="#fafaf7" text-anchor="middle">SP</text>
</svg>
```

- [ ] **Step 5: Run tests and formatting to verify they pass**

Run: `npm run format && npm test && npm run format:check`
Expected: 7 tests pass; prettier reports all files formatted.

- [ ] **Step 6: Check the Review Focus rules in the CSS**

Confirm by reading `public/styles.css`:

- `main` has side padding `1rem` and no fixed widths wider than the viewport; `.app` has `overflow-wrap: anywhere` (phone width).
- Every color used is a `var(--…)` token redefined in the `prefers-color-scheme: dark` block (dark mode).
- `a:focus-visible` sets a visible outline (keyboard focus).

Then run `npx wrangler dev --port 8787` in the background and check:
`curl -s localhost:8787/ | grep -c "app-name"` → `3`;
`curl -s -o /dev/null -w "%{http_code}" localhost:8787/styles.css` → `200`. Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore .prettierignore test public
git commit -m "Add landing page with app links"
```

---

### Task 2: Worker config and deploy pipeline

**Files:**

- Create: `wrangler.jsonc`
- Create: `.github/workflows/deploy.yml`
- Create: `README.md`
- Modify: `test/page.test.mjs` (append config test)

**Interfaces:**

- Consumes: `public/` and npm scripts `test`, `format:check` from Task 1.
- Produces: `npx wrangler deploy` deploys Worker `sundeepparuchuri-com` with apex custom domain; workflow requires repo secret `CLOUDFLARE_API_TOKEN`.

- [ ] **Step 1: Write the failing config test**

Append to `test/page.test.mjs`:

```js
test("worker serves public/ on the apex custom domain", async () => {
  const config = JSON.parse(
    await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  );
  assert.equal(config.name, "sundeepparuchuri-com");
  assert.equal(config.assets.directory, "./public");
  assert.equal(config.main, undefined);
  assert.deepEqual(config.routes, [
    { pattern: "sundeepparuchuri.com", custom_domain: true },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `ENOENT` reading `wrangler.jsonc`.

- [ ] **Step 3: Write the config**

`wrangler.jsonc` (no comments, so the test can `JSON.parse` it):

```json
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "sundeepparuchuri-com",
  "compatibility_date": "2026-10-01",
  "assets": {
    "directory": "./public"
  },
  "routes": [{ "pattern": "sundeepparuchuri.com", "custom_domain": true }]
}
```

- [ ] **Step 4: Run tests and dry-run deploy**

Run: `npm test && npx wrangler deploy --dry-run`
Expected: 8 tests pass; dry run lists the 3 asset files and exits 0.

- [ ] **Step 5: Write the workflow**

`.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run format:check
      - run: npm test
      - run: npx wrangler deploy --dry-run

  deploy:
    needs: check
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: 25f64b68ea2441b677f6788b470be590
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx wrangler deploy
      - name: Smoke test live site
        run: |
          for attempt in 1 2 3 4 5 6; do
            if curl -fsS https://sundeepparuchuri.com/ | grep -q "Sundeep Paruchuri"; then
              exit 0
            fi
            sleep 10
          done
          echo "sundeepparuchuri.com did not serve the landing page" >&2
          exit 1
```

- [ ] **Step 6: Write the README**

`README.md`:

````markdown
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

To add an app, add an `<li>` card to `public/index.html` and its URL to the
expected-links test in `test/page.test.mjs`.

## One-time Cloudflare setup

The domain is registered at Squarespace; DNS and hosting are on Cloudflare.

1. Create an API token from the **Edit Cloudflare Workers** template, scoped to
   this account and the `sundeepparuchuri.com` zone. Save it as the repo secret
   `CLOUDFLARE_API_TOKEN`.
2. The first deploy creates the apex DNS record and certificate.
3. `www`: a proxied CNAME to `sundeepparuchuri.com` plus the Redirect Rule
   "Redirect www to apex": `*://www.sundeepparuchuri.com/*` →
   `https://sundeepparuchuri.com/${2}` (301, query string preserved).
````

- [ ] **Step 7: Format, test, commit**

Run: `npm run format && npm test && npm run format:check`
Expected: 8 tests pass; all files formatted.

```bash
git add wrangler.jsonc .github README.md test/page.test.mjs
git commit -m "Add Worker config and deploy workflow"
```

---

### Task 3: Publish and go live

Needs Sundeep for the API token. Do not create or paste the token yourself.

**Files:** none.

**Interfaces:**

- Consumes: the repo from Tasks 1–2; the `www` redirect configured in the Cloudflare dashboard.

- [ ] **Step 1: Create the GitHub repo and push**

```bash
gh repo create sunpar/sundeepparuchuri.com --public --source . --description "Public homepage for sundeepparuchuri.com" --push
```

Expected: repo created; first workflow run starts and its `deploy` job fails at `wrangler deploy` because the secret is missing. `check` must pass.

- [ ] **Step 2: Sundeep adds the API token**

Ask Sundeep to create the token (README step 1) and run in their own terminal:

```bash
gh secret set CLOUDFLARE_API_TOKEN --repo sunpar/sundeepparuchuri.com
```

- [ ] **Step 3: Re-run the deploy**

```bash
gh run rerun --failed --repo sunpar/sundeepparuchuri.com $(gh run list --repo sunpar/sundeepparuchuri.com --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch --repo sunpar/sundeepparuchuri.com
```

Expected: `deploy` job succeeds including the smoke test.

- [ ] **Step 4: Verify the apex**

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://sundeepparuchuri.com/`
Expected: `200`.

- [ ] **Step 5: Verify the app links resolve**

Run: `for h in until ridgewoodtax wm; do curl -s -o /dev/null -w "$h %{http_code}\n" https://$h.sundeepparuchuri.com/; done`
Expected: `until 302`, `ridgewoodtax 302` (Cloudflare Access login), `wm 200`.

- [ ] **Step 6: Verify www redirect and 404**

Run: `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "https://www.sundeepparuchuri.com/some/path?x=1"`
Expected: `301 https://sundeepparuchuri.com/some/path?x=1`.

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://sundeepparuchuri.com/nope`
Expected: `404`.
