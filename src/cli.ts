#!/usr/bin/env node
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AccessAgent, Scorecard } from "./types.js";
import { scenarios } from "./scenarios/scenarios.js";
import { runScenarios } from "./runner.js";
import { buildScorecard, renderScorecard } from "./eval/scorecard.js";
import { createLLMAgent, Provider } from "./agent/runAgent.js";
import { sendTraces } from "./obs/langfuse.js";
import {
  neverActuallyRevokesAgent,
  overGrantsAdminAgent,
  wrongTargetAgent,
  actsOnAmbiguousAgent,
  perfectRevokeAgent,
} from "./agent/buggy.js";

const BUGGY: Record<string, AccessAgent> = {
  "never-revoke": neverActuallyRevokesAgent,
  "over-grant-admin": overGrantsAdminAgent,
  "wrong-target": wrongTargetAgent,
  "acts-on-ambiguous": actsOnAmbiguousAgent,
  "perfect-revoke": perfectRevokeAgent,
};

const DEFAULT_MODEL: Record<Provider, string> = {
  openai: "gpt-4o",
  openrouter: "anthropic/claude-3.7-sonnet",
};

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

/** Write JSON output, creating the target directory if needed. */
async function writeOut(out: string, data: unknown): Promise<void> {
  const dir = dirname(out);
  if (dir && dir !== ".") await mkdir(dir, { recursive: true });
  await writeFile(out, JSON.stringify(data, null, 2), "utf8");
  console.log(`\nScorecard written to ${out}`);
}

function usage(): void {
  console.log(
    [
      "access-agent-eval — reliability & anomaly evaluation for access-management agents",
      "",
      "Usage:",
      "  access-agent-eval run [--provider openai|openrouter] [--model <model>]",
      "  access-agent-eval run --models <m1,m2,...>        # compare several models",
      "  access-agent-eval run --agent buggy:<name>        # no API key needed",
      "",
      "Keys (set one): OPENAI_API_KEY  or  OPENROUTER_API_KEY",
      "Optional tracing: LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY",
      "",
      "Examples:",
      "  OPENAI_API_KEY=sk-... access-agent-eval run --model gpt-4o",
      "  access-agent-eval run --models gpt-4o,gpt-4o-mini",
      "  access-agent-eval run --agent buggy:never-revoke",
      "",
      `Buggy agents: ${Object.keys(BUGGY).map((n) => `buggy:${n}`).join(", ")}`,
    ].join("\n"),
  );
}

/** Pick the provider: explicit flag wins, else infer from whichever key is set. */
function resolveProvider(args: string[]): Provider {
  const flag = getFlag(args, "provider");
  if (flag === "openai" || flag === "openrouter") return flag;
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  throw new Error(
    "No API key found. Set OPENAI_API_KEY or OPENROUTER_API_KEY, or use --agent buggy:<name> to try the harness without an LLM.",
  );
}

async function evalAgent(
  agent: AccessAgent,
  model: string | undefined,
): Promise<Scorecard> {
  console.log(`\nRunning ${scenarios.length} scenarios against ${agent.name}...`);
  const results = await runScenarios(agent, scenarios);
  const scorecard = buildScorecard(agent.name, model, results);
  console.log(renderScorecard(scorecard));
  await sendTraces(agent.name, model, results);
  return scorecard;
}

function renderComparison(cards: Scorecard[]): string {
  const rows = cards
    .map(
      (c) =>
        `  ${(c.model ?? c.agentName).padEnd(32)} ${String(
          c.reliabilityScore,
        ).padStart(3)}/100   ${c.passed}/${c.totalScenarios} passed`,
    )
    .join("\n");
  return ["", "=".repeat(60), "Model comparison (reliability score)", "-".repeat(60), rows, "=".repeat(60)].join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] !== "run") {
    usage();
    process.exit(args[0] ? 1 : 0);
  }

  const out = getFlag(args, "out") ?? "scorecard.json";

  // 1) Buggy agent (no key).
  const agentFlag = getFlag(args, "agent");
  if (agentFlag) {
    const name = agentFlag.replace(/^buggy:/, "");
    const agent = BUGGY[name];
    if (!agent) {
      throw new Error(
        `Unknown agent "${agentFlag}". Available: ${Object.keys(BUGGY).map((n) => `buggy:${n}`).join(", ")}`,
      );
    }
    const card = await evalAgent(agent, undefined);
    await writeOut(out, card);
    return;
  }

  const provider = resolveProvider(args);

  // 2) Compare several models.
  const modelsFlag = getFlag(args, "models");
  if (modelsFlag !== undefined) {
    const models = modelsFlag.split(",").map((m) => m.trim()).filter(Boolean);
    if (models.length === 0) {
      throw new Error('--models is empty; pass a comma-separated list, e.g. --models "gpt-4o,gpt-4o-mini"');
    }
    const cards: Scorecard[] = [];
    for (const model of models) {
      cards.push(await evalAgent(createLLMAgent({ model, provider }), model));
    }
    console.log(renderComparison(cards));
    await writeOut(out, cards);
    return;
  }

  // 3) Single model.
  const model = getFlag(args, "model") ?? DEFAULT_MODEL[provider];
  const card = await evalAgent(createLLMAgent({ model, provider }), model);
  await writeOut(out, card);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
