#!/usr/bin/env node
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Page } from "playwright";
import type { AccessAgent } from "../types.js";
import { scenarios } from "../scenarios/scenarios.js";
import { buildScorecard, renderScorecard } from "../eval/scorecard.js";
import { runBrowserScenarios } from "./runner.js";
import { makeBrowserAgent, BROWSER_POLICIES } from "./browserAgents.js";
import { makeBrowserLLMAgent } from "./browserLLM.js";
import type { Provider } from "../agent/runAgent.js";

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
      "  browse [--agent browser:<name>]      # offline, deterministic policy, no key",
      "  browse --agent llm:<model>           # a REAL model drives the UI (needs a key)",
      "  browse [--video] [--scenario <id>]",
      "",
      `Browser policies (offline): ${Object.keys(BROWSER_POLICIES).map((n) => `browser:${n}`).join(", ")}`,
      "",
      "Real LLM in the browser loop (multi-turn observe/act, verdict read from the DOM):",
      "  OPENAI_API_KEY=sk-...     browse --agent llm:gpt-4o --provider openai",
      "  OPENROUTER_API_KEY=sk-... browse --agent llm:anthropic/claude-3.7-sonnet",
    ].join("\n"),
  );
}

async function writeOut(out: string, data: unknown): Promise<void> {
  const dir = dirname(out);
  if (dir && dir !== ".") await mkdir(dir, { recursive: true });
  await writeFile(out, JSON.stringify(data, null, 2), "utf8");
  console.log(`\nScorecard written to ${out}`);
}

/** Resolve provider: explicit flag, else infer from whichever key is set. */
function resolveProvider(args: string[]): Provider {
  const flag = getFlag(args, "provider");
  if (flag === "openai" || flag === "openrouter") return flag;
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  throw new Error(
    "No API key found for the llm agent. Set OPENAI_API_KEY or OPENROUTER_API_KEY, or use --agent browser:<policy> to run offline.",
  );
}

/** Build the agent factory from the --agent flag (deterministic policy or real LLM). */
function resolveMakeAgent(args: string[]): (page: Page) => AccessAgent {
  const agentFlag = getFlag(args, "agent") ?? "browser:perfect-revoke";

  if (agentFlag.startsWith("llm:")) {
    const model = agentFlag.slice("llm:".length);
    if (!model) throw new Error('Pass a model, e.g. --agent llm:gpt-4o');
    const provider = resolveProvider(args);
    return (page) => makeBrowserLLMAgent(page, { model, provider });
  }

  const policyName = agentFlag.replace(/^browser:/, "");
  const policy = BROWSER_POLICIES[policyName];
  if (!policy) {
    throw new Error(
      `Unknown agent "${agentFlag}". Use --agent llm:<model> or one of: ${Object.keys(BROWSER_POLICIES)
        .map((n) => `browser:${n}`)
        .join(", ")}`,
    );
  }
  return (page) => makeBrowserAgent(page, policy);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return;
  }

  const agentFlag = getFlag(args, "agent") ?? "browser:perfect-revoke";
  const makeAgent = resolveMakeAgent(args);
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
    makeAgent,
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
