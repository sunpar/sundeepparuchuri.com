import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprint } from "../scripts/local-checks.mjs";
import { withSnapshot, gatePush, createPr } from "../scripts/git-gate.mjs";

const source = fileURLToPath(new URL("..", import.meta.url));
const gate = join(source, "scripts/git-gate.mjs");
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), "site-gate-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-b", "topic");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Gate test");
  git("config", "core.hooksPath", ".githooks");
  for (const directory of [
    "scripts",
    ".githooks",
    "test",
    "node_modules",
    "public",
  ])
    mkdirSync(join(root, directory));
  for (const file of [
    "package.json",
    "package-lock.json",
    ".prettierrc.json",
    ".prettierignore",
    "wrangler.jsonc",
  ])
    copyFileSync(join(source, file), join(root, file));
  cpSync(join(source, "public"), join(root, "public"), { recursive: true });
  for (const file of [
    "scripts/git-gate.mjs",
    "scripts/local-checks.mjs",
    "scripts/no-network.cjs",
    ".githooks/pre-commit",
    ".githooks/pre-push",
  ]) {
    copyFileSync(join(source, file), join(root, file));
  }
  for (const file of ["pre-commit", "pre-push"])
    chmodSync(join(root, ".githooks", file), 0o755);
  writeFileSync(join(root, ".gitignore"), "node_modules/\n.wrangler/\n");
  writeFileSync(
    join(root, "test/page.test.mjs"),
    'import assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\nassert.equal(readFileSync("value.txt", "utf8"), "good\\n");\n',
  );
  writeFileSync(join(root, "value.txt"), "good\n");
  for (const name of ["prettier", "wrangler"])
    symlinkSync(
      join(source, "node_modules", name),
      join(root, "node_modules", name),
      "dir",
    );
  writeFileSync(
    join(root, "node_modules/.local-dependencies"),
    fingerprint(root),
  );
  git("add", ".");
  git("-c", "core.hooksPath=/dev/null", "commit", "-m", "Initial fixture");
  const run = (operation, args = [], extra = {}) =>
    spawnSync(process.execPath, [gate, operation, ...args], {
      cwd: root,
      env: { ...env, ...extra },
      encoding: "utf8",
    });
  return { root, git, run };
}

const output = (result) => `${result.stdout}${result.stderr}`;

test("staged checks pass without including unstaged failures or untracked files", (t) => {
  const { root, run } = repository(t);
  writeFileSync(join(root, "value.txt"), "bad\n");
  writeFileSync(join(root, "untracked.mjs"), "broken javascript ???");
  const result = run("commit");
  assert.equal(result.status, 0, output(result));
  assert.equal(readFileSync(join(root, "value.txt"), "utf8"), "bad\n");
});

test("unstaged fixes cannot rescue a failing staged snapshot", (t) => {
  const { root, git, run } = repository(t);
  writeFileSync(join(root, "value.txt"), "bad\n");
  git("add", "value.txt");
  writeFileSync(join(root, "value.txt"), "good\n");
  const result = run("commit");
  assert.notEqual(result.status, 0, output(result));
  assert.match(output(result), /bad/);
  assert.equal(git("show", ":value.txt"), "bad");
});

test("commit capture respects an alternate active index", (t) => {
  const { root, git, run } = repository(t);
  const index = join(root, ".git/alternate-index");
  copyFileSync(join(root, ".git/index"), index);
  writeFileSync(join(root, "value.txt"), "bad\n");
  execFileSync("git", ["add", "value.txt"], {
    cwd: root,
    env: { ...env, GIT_INDEX_FILE: index },
  });
  const result = run("commit", [], { GIT_INDEX_FILE: index });
  assert.notEqual(result.status, 0, output(result));
  assert.match(output(result), /bad/);
  assert.equal(git("show", ":value.txt"), "good");
});

test("missing or mismatched dependencies stop the hook with setup instructions", (t) => {
  const { root, run } = repository(t);
  rmSync(join(root, "node_modules/.local-dependencies"));
  let result = run("commit");
  assert.notEqual(result.status, 0, output(result));
  assert.match(output(result), /npm run deps/);
  writeFileSync(join(root, "node_modules/.local-dependencies"), "old inputs");
  result = run("commit");
  assert.notEqual(result.status, 0, output(result));
  assert.match(output(result), /npm run deps/);
});

function github(root, mode) {
  const bin = join(root, ".git/test-bin");
  mkdirSync(bin);
  const file = join(bin, "gh");
  writeFileSync(
    file,
    `#!/bin/sh\ncase "$1 $2" in\n  "repo view") echo '{"nameWithOwner":"sunpar/sundeepparuchuri.com"}' ;;\n  "api repos/sunpar/sundeepparuchuri.com/pulls")\n    echo "$*" >> '${join(root, ".git/gh-requests")}'\n    ${mode === "error" ? 'echo "GitHub unavailable: run gh auth status" >&2; exit 1' : mode === "malformed" ? "echo '{}'" : mode === "none" ? "echo '[[]]'" : `echo '[[{"head":{"repo":{"full_name":"sunpar/sundeepparuchuri.com"}}}]]'`}\n    ;;\n  *) echo "unexpected gh operation" >&2; exit 1 ;;\nesac\n`,
  );
  chmodSync(file, 0o755);
  return { PATH: `${bin}:${env.PATH}` };
}

test("real pre-push checks outgoing non-HEAD commits and destination branch names", (t) => {
  const { root, git } = repository(t);
  writeFileSync(join(root, "value.txt"), "bad\n");
  git("add", "value.txt");
  git(
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-m",
    "Invalid outgoing commit",
  );
  const bad = git("rev-parse", "HEAD");
  writeFileSync(join(root, "value.txt"), "good\n");
  git("add", "value.txt");
  git("-c", "core.hooksPath=/dev/null", "commit", "-m", "Working HEAD is good");
  const remote = join(root, ".git/remote.git");
  execFileSync("git", ["init", "--bare", remote], { env, stdio: "ignore" });
  const result = spawnSync(
    "git",
    ["push", remote, `${bad}:refs/heads/review`],
    { cwd: root, env: { ...env, ...github(root, "open") }, encoding: "utf8" },
  );
  assert.notEqual(result.status, 0, output(result));
  assert.match(output(result), /bad/);
  assert.match(
    readFileSync(join(root, ".git/gh-requests"), "utf8"),
    /head=sunpar:review/,
  );
  assert.equal(
    execFileSync("git", ["--git-dir", remote, "for-each-ref"], {
      env,
      encoding: "utf8",
    }),
    "",
  );
});

for (const mode of ["error", "malformed"]) {
  test(`${mode} PR lookup blocks a real push`, (t) => {
    const { root } = repository(t);
    const remote = join(root, ".git/remote.git");
    execFileSync("git", ["init", "--bare", remote], { env, stdio: "ignore" });
    const result = spawnSync(
      "git",
      ["push", remote, "HEAD:refs/heads/review"],
      { cwd: root, env: { ...env, ...github(root, mode) }, encoding: "utf8" },
    );
    assert.notEqual(result.status, 0, output(result));
    assert.match(output(result), /PR lookup|gh auth status/);
    assert.equal(
      execFileSync("git", ["--git-dir", remote, "for-each-ref"], {
        env,
        encoding: "utf8",
      }),
      "",
    );
  });
}

test("branches without open PRs can push without full verification", (t) => {
  const { root } = repository(t);
  rmSync(join(root, "node_modules/.local-dependencies"));
  const remote = join(root, ".git/remote.git");
  execFileSync("git", ["init", "--bare", remote], { env, stdio: "ignore" });
  const result = spawnSync("git", ["push", remote, "HEAD:refs/heads/topic"], {
    cwd: root,
    env: { ...env, ...github(root, "none") },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, output(result));
});

test("the PR wrapper stops before publishing when full verification fails", (t) => {
  const { root, run } = repository(t);
  rmSync(join(root, "node_modules/.local-dependencies"));
  const result = run("pr", ["--title", "Test PR"], github(root, "error"));
  assert.notEqual(result.status, 0, output(result));
  assert.match(output(result), /npm run deps/);
  assert.equal(existsSync(join(root, ".git/gh-requests")), false);
});

test("the PR wrapper rejects repository, head, web and dry-run overrides", (t) => {
  const { run } = repository(t);
  for (const flag of [
    "--repo=other/repo",
    "--head=other",
    "--web",
    "--dry-run",
    "-R",
    "-H",
  ]) {
    const result = run("pr", [flag]);
    assert.notEqual(result.status, 0, output(result));
    assert.match(output(result), /Unsupported PR flag/);
  }
});

test("verification processes block external TCP and permit loopback HTTP", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--require",
      join(source, "scripts/no-network.cjs"),
      "-e",
      `
    const assert = require('node:assert/strict');
    const net = require('node:net');
    const http = require('node:http');
    assert.throws(() => net.connect({host: '198.51.100.1', port: 443}), /External network disabled/);
    assert.throws(() => net.connect(443, 'api.cloudflare.com'), /External network disabled/);
    const server = http.createServer((req, res) => res.end('local'));
    server.listen(0, '127.0.0.1', async () => {
      assert.equal(await (await fetch('http://127.0.0.1:' + server.address().port)).text(), 'local');
      server.closeAllConnections();
      server.close();
      console.log('blocked external; allowed loopback');
    });
  `,
    ],
    { env, encoding: "utf8", timeout: 5000 },
  );
  assert.equal(result.status, 0, output(result));
  assert.match(output(result), /blocked external; allowed loopback/);
});

test("staged dependency inputs must match even when the working tree matches", (t) => {
  const { root, git, run } = repository(t);
  const manifest = readFileSync(join(root, "package.json"), "utf8");
  writeFileSync(
    join(root, "package.json"),
    manifest.replace('"private": true', '"private": false'),
  );
  git("add", "package.json");
  writeFileSync(join(root, "package.json"), manifest);
  const result = run("commit");
  assert.notEqual(result.status, 0, output(result));
  assert.match(output(result), /npm run deps/);
});

test("snapshots honor staged deletions and clean up after a failed check", async (t) => {
  const { root, git } = repository(t);
  writeFileSync(join(root, "removed.txt"), "removed\n");
  git("add", "removed.txt");
  git("-c", "core.hooksPath=/dev/null", "commit", "-m", "Add removed file");
  git("rm", "--cached", "removed.txt");
  let directory;
  await assert.rejects(
    withSnapshot(root, { staged: true }, (snapshot) => {
      directory = snapshot;
      assert.equal(existsSync(join(snapshot, "removed.txt")), false);
      assert.equal(readFileSync(join(snapshot, "value.txt"), "utf8"), "good\n");
      throw new Error("suite failed");
    }),
    /suite failed/,
  );
  assert.equal(existsSync(directory), false);
  assert.equal(existsSync(join(root, "removed.txt")), true);
});

test("committed snapshots use the requested ref and clean up after success", async (t) => {
  const { root, git } = repository(t);
  const original = git("rev-parse", "HEAD");
  writeFileSync(join(root, "value.txt"), "new head\n");
  git("add", "value.txt");
  git("-c", "core.hooksPath=/dev/null", "commit", "-m", "Advance HEAD");
  let directory;
  await withSnapshot(root, { ref: original }, (snapshot) => {
    directory = snapshot;
    assert.equal(readFileSync(join(snapshot, "value.txt"), "utf8"), "good\n");
  });
  assert.equal(existsSync(directory), false);
});

test("main pushes require verification even without an open PR", (t) => {
  const { root, git } = repository(t);
  rmSync(join(root, "node_modules/.local-dependencies"));
  const githubEnv = github(root, "none");
  // The hook gets updates on standard input; exercise that boundary directly.
  const push = spawnSync(
    process.execPath,
    [gate, "push", "origin", "test-remote"],
    {
      cwd: root,
      env: { ...env, ...githubEnv },
      encoding: "utf8",
      input: `refs/heads/topic ${git("rev-parse", "HEAD")} refs/heads/main ${"0".repeat(40)}\n`,
    },
  );
  assert.notEqual(push.status, 0, output(push));
  assert.match(output(push), /npm run deps/);
});

test("deletions and tags skip PR lookup; multiple branches verify each SHA once", async () => {
  await gatePush(
    source,
    "origin",
    `refs/heads/topic ${"0".repeat(40)} refs/heads/topic ${"a".repeat(40)}\nrefs/tags/v1 ${"a".repeat(40)} refs/tags/v1 ${"0".repeat(40)}`,
    () => {
      throw new Error("unexpected lookup");
    },
  );
  const checked = [];
  await gatePush(
    source,
    "origin",
    `refs/heads/local ${"a".repeat(40)} refs/heads/review ${"0".repeat(40)}\nrefs/heads/local ${"a".repeat(40)} refs/heads/second ${"0".repeat(40)}`,
    (command, args) =>
      args[0] === "repo"
        ? '{"nameWithOwner":"sunpar/sundeepparuchuri.com"}'
        : '[[{"head":{"repo":{"full_name":"sunpar/sundeepparuchuri.com"}}}]]',
    (sha) => checked.push(sha),
  );
  assert.deepEqual(checked, ["a".repeat(40)]);
});

test("the PR wrapper publishes the checked SHA to the fixed repository despite a changed local HEAD", async (t) => {
  const { root, git } = repository(t);
  const sha = git("rev-parse", "HEAD");
  const writes = [];
  git(
    "remote",
    "add",
    "origin",
    "https://github.com/sunpar/sundeepparuchuri.com.git",
  );
  await createPr(
    root,
    ["--draft", "--title", "Fixture PR"],
    (command, args) => {
      if (command === "git" && args[0] === "push") {
        writes.push(args);
        return "";
      }
      if (command === "git" && args[0] === "ls-remote")
        return `${sha}\trefs/heads/topic`;
      if (command === "git") return git(...args);
      if (args[0] === "repo")
        return '{"nameWithOwner":"sunpar/sundeepparuchuri.com"}';
      if (args[1] === "create") {
        writes.push(args);
        return "";
      }
      return JSON.stringify({
        url: "https://github.com/sunpar/sundeepparuchuri.com/pull/123",
        headRefOid: sha,
      });
    },
    (checked) => {
      assert.equal(checked, sha);
      git(
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "--allow-empty",
        "-m",
        "Advance local HEAD during checks",
      );
    },
  );
  assert.deepEqual(writes, [
    [
      "push",
      "https://github.com/sunpar/sundeepparuchuri.com.git",
      `${sha}:refs/heads/topic`,
    ],
    [
      "pr",
      "create",
      "--repo",
      "sunpar/sundeepparuchuri.com",
      "--head",
      "topic",
      "--assignee",
      "@me",
      "--draft",
      "--title",
      "Fixture PR",
    ],
  ]);
});

test("PR creation refuses main before verification or publication", async (t) => {
  const { root, git } = repository(t);
  git("branch", "-M", "main");
  const published = [];
  await assert.rejects(
    createPr(
      root,
      [],
      (command, args) => {
        if (
          command === "git" &&
          ["symbolic-ref", "rev-parse"].includes(args[0])
        )
          return git(...args);
        published.push([command, args]);
        throw new Error("unexpected publication");
      },
      () => {},
    ),
    /feature branch/,
  );
  assert.deepEqual(published, []);
});

test("committed snapshots ignore export attributes and preserve the active index", async (t) => {
  const { root, git } = repository(t);
  writeFileSync(
    join(root, ".gitattributes"),
    "test/** export-ignore\nvalue.txt export-subst\n",
  );
  writeFileSync(join(root, "value.txt"), "good $Format:%H$\n");
  git("add", ".gitattributes", "value.txt");
  git(
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-m",
    "Set export attributes",
  );
  writeFileSync(join(root, "pending.txt"), "staged only\n");
  git("add", "pending.txt");
  const index = git("write-tree");
  await withSnapshot(root, { ref: "HEAD" }, (snapshot) => {
    assert.equal(existsSync(join(snapshot, "test/page.test.mjs")), true);
    assert.equal(
      readFileSync(join(snapshot, "value.txt"), "utf8"),
      "good $Format:%H$\n",
    );
    assert.equal(existsSync(join(snapshot, "pending.txt")), false);
  });
  assert.equal(git("write-tree"), index);
});

test("fork pushes find their PR in the project base repository", async () => {
  const checked = [];
  await gatePush(
    source,
    "fork",
    `refs/heads/local ${"b".repeat(40)} refs/heads/review ${"0".repeat(40)}`,
    (command, args) => {
      if (args[0] === "repo")
        return '{"nameWithOwner":"contributor/sundeepparuchuri.com"}';
      if (
        args[0] === "api" &&
        args[1] === "repos/sunpar/sundeepparuchuri.com/pulls" &&
        args.includes("head=contributor:review")
      )
        return '[[{"head":{"repo":{"full_name":"contributor/sundeepparuchuri.com"}}}]]';
      return "[]";
    },
    (sha) => checked.push(sha),
  );
  assert.deepEqual(checked, ["b".repeat(40)]);
});

test("matching PRs on later API pages still require verification", async () => {
  const checked = [];
  const foreign = {
    head: { repo: { full_name: "other/sundeepparuchuri.com" } },
    headRepository: { name: "sundeepparuchuri.com" },
    headRepositoryOwner: { login: "other" },
  };
  const own = { head: { repo: { full_name: "sunpar/sundeepparuchuri.com" } } };
  await gatePush(
    source,
    "origin",
    `refs/heads/local ${"c".repeat(40)} refs/heads/review ${"0".repeat(40)}`,
    (command, args) => {
      if (args[0] === "repo")
        return '{"nameWithOwner":"sunpar/sundeepparuchuri.com"}';
      return args.includes("--paginate") && args.includes("--slurp")
        ? JSON.stringify([Array(30).fill(foreign), [own]])
        : JSON.stringify(Array(30).fill(foreign));
    },
    (sha) => checked.push(sha),
  );
  assert.deepEqual(checked, ["c".repeat(40)]);
});

test("PR creation refuses a configured origin pointing at another repository", async (t) => {
  const { root, git } = repository(t);
  git("remote", "add", "origin", "https://github.com/other/repo.git");
  const published = [];
  await assert.rejects(
    createPr(
      root,
      [],
      (command, args) => {
        if (
          command === "git" &&
          ["symbolic-ref", "rev-parse", "remote"].includes(args[0])
        )
          return git(...args);
        if (command === "gh" && args[0] === "repo")
          return '{"nameWithOwner":"other/repo"}';
        published.push([command, args]);
        throw new Error("unexpected publication");
      },
      () => {},
    ),
    /origin.*sunpar\/sundeepparuchuri.com/,
  );
  assert.deepEqual(published, []);
});
