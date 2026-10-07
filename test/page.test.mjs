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

test("links only to GitHub and the four apps", () => {
  assert.deepEqual(externalLinks.sort(), [
    "https://github.com/sunpar",
    "https://ridgewoodtax.sundeepparuchuri.com",
    "https://stackline.sundeepparuchuri.com",
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
      "https://stackline.sundeepparuchuri.com",
      "Stackline",
      "Poker sessions, bankroll, and analytics",
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
  assert.ok(cardFor("https://stackline.sundeepparuchuri.com").includes(label));
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
