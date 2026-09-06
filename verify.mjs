#!/usr/bin/env node
/**
 * Verify this published copy is internally consistent and actually runnable.
 *
 * Three questions, each of which can fail:
 *   1. Do the shipped files match the sha256 in manifest.json? A hand-edit, a
 *      truncated sync or a line-ending rewrite all show up here.
 *   2. Does the relay's own --selftest pass? A real handshake and a real
 *      masked broadcast, decoded the way a browser decodes it.
 *   3. Does `node relay.js` actually SERVE the control room and the overlay
 *      over HTTP? A relay that only speaks WebSocket leaves the operator on
 *      file:// query-param flakiness, which is the defect this arm exists for.
 *
 * Exit 0 all passed, 1 a real failure, 2 the harness could not run -- never 0
 * on "could not check", because an empty run and a clean one look identical
 * from the outside.
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

let failed = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` (${detail})` : ""}`);
};
const dead = (why) => { console.error(`COULD NOT RUN: ${why}`); process.exit(2); };

if (!existsSync("manifest.json")) dead("no manifest.json beside this script");
let manifest;
try { manifest = JSON.parse(readFileSync("manifest.json", "utf8")); }
catch (e) { dead(`manifest.json will not parse: ${e.message}`); }
if (!manifest.files || !Object.keys(manifest.files).length) dead("manifest names no files");

console.log(`verify: kit v${manifest.version} (from ${String(manifest.source_commit).slice(0, 10)})`);

// 1. Hashes. The kit's own quick-start is README.md INSIDE the zip and is
// published here as README-kit.md, so that one name is mapped.
const LOCAL_NAME = { "README.md": "README-kit.md" };
for (const [name, meta] of Object.entries(manifest.files)) {
  const path = LOCAL_NAME[name] || name;
  if (!existsSync(path)) { check(`${path} present`, false); continue; }
  const got = createHash("sha256").update(readFileSync(path)).digest("hex");
  check(`${path} matches manifest sha256`, got === meta.sha256,
        got === meta.sha256 ? "" : `have ${got.slice(0, 12)}, want ${String(meta.sha256).slice(0, 12)}`);
}

// --no-exec: check the HASHES only, and run nothing.
//
// The sync lane fetches these files from a remote origin and must decide
// whether to commit them. Running relay.js to make that decision would execute
// the very bytes under suspicion, on a runner holding write access -- so the
// executable arms below are opt-out, and the sync lane opts out. They still run
// on every push and pull request (verify.yml), where the code has already been
// committed and the token is read-only.
if (process.argv.includes("--no-exec")) {
  console.log(failed ? "\nverify: " + failed + " failure(s)" : "\nverify: hashes match (--no-exec: nothing was run)");
  process.exit(failed ? 1 : 0);
}

// 2. The relay proves itself.
const st = spawnSync(process.execPath, ["relay.js", "--selftest"], { encoding: "utf8", timeout: 20000 });
check("relay --selftest (handshake + masked broadcast)", st.status === 0,
      (st.stdout || st.stderr || "").trim().slice(0, 70));

// 3. It really serves the pages.
// The relay is started on a random high port and WATCHED: if the child exits
// before it answers, that is a port already in use (relay.js exits 1 on a
// listen error, and stdio is ignored so nothing prints it) -- retry on a fresh
// port rather than reporting a defect that is not there. A gate that fails at
// random teaches people to re-run until green, which trains away the signal.
async function startRelay(attempts = 3) {
  for (let a = 0; a < attempts; a++) {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, ["relay.js", String(port)], { stdio: "ignore" });
    let died = false;
    child.on("exit", () => { died = true; });
    for (let i = 0; i < 40 && !died; i++) {
      try { await fetch(`http://127.0.0.1:${port}/`); return { child, port }; }
      catch { await sleep(250); }
    }
    child.kill();
    if (!died) return null;   // it never died AND never answered: a real failure
  }
  return null;
}

const started = await startRelay();
if (!started) dead("relay never answered on any of 3 ports");
const { child: relay, port } = started;

for (const [path, needle] of [["/", "control room"], ["/overlay.html", "tug-of-war"]]) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    const body = await res.text();
    check(`serves ${path}`, res.status === 200 && body.toLowerCase().includes(needle), `HTTP ${res.status}`);
  } catch (e) {
    check(`serves ${path}`, false, e.message);
  }
}

relay.kill();
await new Promise((r) => { relay.on("close", r); setTimeout(r, 1500); });

console.log(failed ? `\nverify: ${failed} failure(s)` : "\nverify: all checks passed");
// process.exitCode, not process.exit(): a forced exit runs libuv teardown on
// the killed child and can abort with an unrelated code on Windows.
process.exitCode = failed ? 1 : 0;
