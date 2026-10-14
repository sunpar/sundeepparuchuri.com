import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(import.meta.url);
const stamp = ".local-dependencies";

export function fingerprint(root) {
  const digest = createHash("sha256").update(
    `${process.versions.node.split(".")[0]}:${process.platform}:${process.arch}`,
  );
  for (const file of ["package.json", "package-lock.json"])
    digest.update(readFileSync(join(root, file)));
  return digest.digest("hex");
}

function checkDependencies(source, target = source) {
  const marker = join(source, "node_modules", stamp);
  if (
    !existsSync(marker) ||
    readFileSync(marker, "utf8") !== fingerprint(target) ||
    !existsSync(join(source, "node_modules/prettier/bin/prettier.cjs")) ||
    !existsSync(join(source, "node_modules/wrangler/bin/wrangler.js"))
  ) {
    throw new Error(
      "Dependencies do not match the checked snapshot. Check out its package.json and package-lock.json, run npm run deps, then retry.",
    );
  }
}

export function attachDependencies(source, target) {
  checkDependencies(source, target);
  symlinkSync(
    join(source, "node_modules"),
    join(target, "node_modules"),
    "dir",
  );
}

async function runtimeSmoke(root) {
  const { unstable_startWorker } = createRequire(join(root, "package.json"))(
    "wrangler",
  );
  const worker = await unstable_startWorker({
    config: join(root, "wrangler.jsonc"),
    dev: {
      remote: false,
      watch: false,
      persist: false,
      server: { hostname: "127.0.0.1", port: 0 },
      inspector: false,
    },
  });
  try {
    const assets = readdirSync(join(root, "public"), {
      recursive: true,
      withFileTypes: true,
    }).filter((entry) => entry.isFile());
    for (const asset of assets) {
      if (asset.name === "404.html") continue;
      const path = join(asset.parentPath, asset.name);
      const url = path.slice(join(root, "public").length).replaceAll("\\", "/");
      const response = await worker.fetch(
        `http://localhost${url === "/index.html" ? "/" : url}`,
        { signal: AbortSignal.timeout(5000) },
      );
      assert.equal(response.status, 200, url);
      assert.deepEqual(
        Buffer.from(await response.arrayBuffer()),
        readFileSync(path),
        url,
      );
    }
    const response = await worker.fetch(
      "http://localhost/__local_verification_missing__",
      { signal: AbortSignal.timeout(5000) },
    );
    assert.equal(response.status, 404);
    assert.equal(
      await response.text(),
      readFileSync(join(root, "public/404.html"), "utf8"),
    );
    console.log(
      `Local runtime smoke passed: ${assets.length - 1} assets and the custom 404 page.`,
    );
  } finally {
    await worker.dispose();
  }
}

export async function runChecks(root, suite) {
  if (process.versions.node.split(".")[0] !== "24")
    throw new Error(
      "Use Node 24, matching hosted verification, then run npm run deps.",
    );
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (
      key.startsWith("GIT_") ||
      /^(CLOUDFLARE_|CF_API_|CF_ACCOUNT_)/.test(key)
    )
      delete env[key];
  const run = (command, args, timeout = 60_000) => {
    console.log(`\n> ${command} ${args.join(" ")}`);
    execFileSync(command, args, { cwd: root, env, stdio: "inherit", timeout });
  };
  if (suite === "deps") {
    rmSync(join(root, "node_modules", stamp), { force: true });
    run("npm", ["ci", "--no-audit", "--no-fund"], 300_000);
    writeFileSync(join(root, "node_modules", stamp), fingerprint(root));
    return;
  }
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --require=${JSON.stringify(fileURLToPath(new URL("./no-network.cjs", import.meta.url)))}`;
  checkDependencies(root);
  if (suite === "runtime") return runtimeSmoke(root);
  if (!["smoke", "full", "coverage"].includes(suite))
    throw new Error("Choose smoke, full or coverage.");
  run(process.execPath, [
    join(root, "node_modules/prettier/bin/prettier.cjs"),
    "--check",
    ".",
  ]);
  run(process.execPath, [
    "--test",
    ...(suite === "smoke"
      ? ["test/page.test.mjs"]
      : suite === "coverage"
        ? [
            "--experimental-test-coverage",
            "--test-coverage-include=scripts/*.*js",
          ]
        : []),
  ]);
  if (suite === "smoke") return;
  run(process.execPath, [
    join(root, "node_modules/wrangler/bin/wrangler.js"),
    "deploy",
    "--dry-run",
    "--outdir",
    ".wrangler/local-build",
  ]);
  run(process.execPath, [script, "runtime"], 30_000);
}

if (process.argv[1] && realpathSync(process.argv[1]) === script) {
  try {
    await runChecks(resolve(process.cwd()), process.argv[2]);
  } catch (error) {
    console.error(`Local verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
