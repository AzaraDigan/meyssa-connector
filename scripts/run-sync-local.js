// Offline dry run: maps the test fixture(s) and prints the Webflow fieldData and
// any review flags. Touches no API. Useful for eyeballing the mapping output
// before session 2 wires up the live clients.
//
// Usage: npm run sync:local

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mapJob } from "../src/mapping/mapJob.js";

const job = JSON.parse(
  readFileSync(fileURLToPath(new URL("../test/fixtures/sample-job.json", import.meta.url)), "utf8"),
);

const { fieldData, unmapped, findings } = mapJob(job);

console.log("=== fieldData (would be sent to Webflow as a draft) ===");
console.log(JSON.stringify(fieldData, null, 2));
console.log("\n=== unmapped required fields (would block the draft, flag for review) ===");
console.log(unmapped.length ? JSON.stringify(unmapped, null, 2) : "(none)");
console.log("\n=== brand-voice findings ===");
console.log(findings.length ? JSON.stringify(findings, null, 2) : "(none)");
