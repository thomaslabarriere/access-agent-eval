#!/usr/bin/env node
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { scenarios } from "../scenarios/scenarios.js";
import { buildScorecard, renderScorecard } from "../eval/scorecard.js";
import { runBrowserScenarios } from "./runner.js";
import { BROWSER_POLICIES } from "./browserAgents.js";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

function usage(): void {
  console.log(
    [
      "access-agent-eval (browser) — evaluate an agent that operates a REAL admin UI",
      "",
      "Usage:",
      "  browse [--agent browser:<name>] [--video]",
      "",
      `Browser agents: ${Object.keys(BROWSER_POLICIES).map((n) => `browser:${n}`).join(", ")}`,
      "",
      "No API key needed — the browser policies are deterministic; they click the",
      "mock console (Playwright) and the verdict is read back from the DOM.",
      "",
      "Examples:",
      "  npm run demo:browser -- --agent browser:never-revoke --video",
      "  npm run demo:browser -- --agent browser:oracle",
    ].join("\n"),
  );
}

async function writeOut(out: string, data: unknown): Promise<void> {
  const dir = dirname(out);
  if (dir && dir !== ".") await mkdir(dir, { recursive: true });
  await writeFile(out, JSON.stringify(data, null, 2), "utf8");
  console.log(`\nScorecard written to ${out}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return;
  }

  const agentFlag = getFlag(args, "agent") ?? "browser:perfect-revoke";
  const policyName = agentFlag.replace(/^browser:/, "");
  const videoDir = args.includes("--video") ? "artifacts/video" : undefined;
  const out = getFlag(args, "out") ?? "scorecard-browser.json";

  const only = getFlag(args, "scenario");
  const selected = only ? scenarios.filter((s) => s.id === only) : scenarios;
  if (selected.length === 0) {
    throw new Error(
      `No scenario with id "${only}". Available: ${scenarios.map((s) => s.id).join(", ")}`,
    );
  }

  console.log(
    `\nOperating the mock admin UI with ${agentFlag} across ${selected.length} scenario(s) (Chromium)...`,
  );
  const { agentName, results, videoPath } = await runBrowserScenarios({
    policyName,
    scenarios: selected,
    videoDir,
  });

  const scorecard = buildScorecard(agentName, "browser", results);
  console.log(renderScorecard(scorecard));
  if (videoPath) console.log(`\nRun recorded to ${videoPath}`);
  await writeOut(out, scorecard);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
