import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { attachDependencies, runChecks } from "./local-checks.mjs";

const repository = "sunpar/sundeepparuchuri.com";
const destination = `git@github.com:${repository}.git`;

function commandRunner(root) {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith("GIT_") && key !== "GIT_INDEX_FILE") delete env[key];
  return (command, args, options = {}) =>
    execFileSync(command, args, {
      cwd: root,
      env,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      ...options,
    })?.trim();
}

export async function withSnapshot(root, { staged = false, ref }, action) {
  const directory = mkdtempSync(join(tmpdir(), "site-check-"));
  const run = commandRunner(root);
  try {
    if (staged)
      run("git", ["checkout-index", "--all", `--prefix=${directory}/`]);
    else {
      const archive = execFileSync("git", ["-C", root, "archive", ref], {
        maxBuffer: 64 * 1024 * 1024,
      });
      run("tar", ["-x", "-C", directory], { input: archive });
    }
    return await action(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function checkSnapshot(root, selection, suite = "full") {
  await withSnapshot(root, selection, async (snapshot) => {
    attachDependencies(root, snapshot);
    await runChecks(snapshot, suite);
  });
}

export async function gatePush(
  root,
  remote,
  input,
  run = commandRunner(root),
  check = (sha) => checkSnapshot(root, { ref: sha }),
) {
  const updates = input
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(/\s+/))
    .filter(
      ([, sha, ref]) => !/^0+$/.test(sha) && ref.startsWith("refs/heads/"),
    );
  if (!updates.length) return;
  const { nameWithOwner } = JSON.parse(
    run("gh", ["repo", "view", remote, "--json", "nameWithOwner"]),
  );
  const tips = new Set();
  for (const [, sha, ref] of updates) {
    const branch = ref.slice("refs/heads/".length);
    if (branch === "main") {
      tips.add(sha);
      continue;
    }
    const prs = JSON.parse(
      run("gh", [
        "pr",
        "list",
        "--repo",
        nameWithOwner,
        "--state",
        "open",
        "--head",
        branch,
        "--json",
        "headRepository,headRepositoryOwner",
      ]),
    );
    if (!Array.isArray(prs))
      throw new Error(
        "PR lookup returned invalid data. Run gh auth status and retry the push.",
      );
    const open = prs.some(
      (pr) =>
        `${pr.headRepositoryOwner.login}/${pr.headRepository.name}`.toLowerCase() ===
        nameWithOwner.toLowerCase(),
    );
    if (open) tips.add(sha);
  }
  for (const sha of tips) {
    console.log(`Checking outgoing commit ${sha}…`);
    await check(sha);
  }
}

export async function createPr(
  root,
  args,
  run = commandRunner(root),
  check = (sha) => checkSnapshot(root, { ref: sha }),
) {
  const values = new Set([
    "--title",
    "-t",
    "--body",
    "-b",
    "--body-file",
    "-F",
    "--base",
    "-B",
    "--reviewer",
    "-r",
    "--label",
    "-l",
  ]);
  const switches = new Set([
    "--draft",
    "-d",
    "--fill",
    "-f",
    "--fill-first",
    "--fill-verbose",
    "--no-maintainer-edit",
  ]);
  if (args.length === 1 && args[0] === "--help")
    return run("gh", ["pr", "create", "--help"], { stdio: "inherit" });
  for (let i = 0; i < args.length; i++) {
    const flag = args[i].split("=")[0];
    if (values.has(flag)) {
      if (!args[i].includes("=") && args[++i] === undefined)
        throw new Error(`Missing value for PR flag ${flag}`);
    } else if (!switches.has(args[i]))
      throw new Error(
        `Unsupported PR flag ${args[i]}. This wrapper fixes the repository and head; web and dry-run modes are unsupported.`,
      );
  }
  const branch = run("git", ["symbolic-ref", "--short", "HEAD"]);
  const sha = run("git", ["rev-parse", "HEAD"]);
  await check(sha);
  run("git", ["push", destination, `${sha}:refs/heads/${branch}`], {
    stdio: "inherit",
  });
  const remoteSha = run("git", [
    "ls-remote",
    destination,
    `refs/heads/${branch}`,
  ]).split(/\s+/)[0];
  if (remoteSha !== sha)
    throw new Error(
      "The remote PR branch changed after verification. Run npm run pr again to verify its new commit.",
    );
  run(
    "gh",
    [
      "pr",
      "create",
      "--repo",
      repository,
      "--head",
      branch,
      "--assignee",
      "@me",
      ...args,
    ],
    { stdio: "inherit" },
  );
  const pr = JSON.parse(
    run("gh", [
      "pr",
      "view",
      branch,
      "--repo",
      repository,
      "--json",
      "url,headRefOid",
    ]),
  );
  console.log(
    `${pr.url}\nVerified commit: ${sha}\nPR head observed after creation: ${pr.headRefOid}`,
  );
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
    const [operation, ...args] = process.argv.slice(2);
    if (operation === "commit")
      await checkSnapshot(root, { staged: true }, "smoke");
    else if (operation === "push")
      await gatePush(root, args[1] ?? args[0], readFileSync(0, "utf8"));
    else if (operation === "pr") await createPr(root, args);
    else if (operation === "check")
      await checkSnapshot(root, { ref: args[0] ?? "HEAD" });
    else
      throw new Error(
        "Usage: git-gate.mjs commit | push <remote> <url> | check [commit] | pr [gh options]",
      );
  } catch (error) {
    console.error(
      `Local checks failed; operation stopped. ${error.message}\nFor GitHub lookup failures, run gh auth status and restore access before retrying.`,
    );
    process.exitCode = 1;
  }
}
