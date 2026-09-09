import { writeFile } from "node:fs/promises";
import { AccessAgent } from "./types.js";
import { scenarios } from "./scenarios/scenarios.js";
import { runScenarios } from "./runner.js";
import { buildScorecard, renderScorecard } from "./eval/scorecard.js";
import { createLLMAgent } from "./agent/runAgent.js";
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

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

function usage(): void {
  console.log(
    [
      "access-agent-eval — reliability & anomaly evaluation for access-management agents",
      "",
      "Usage:",
      "  access-agent-eval run [--model <openrouter-model>] [--agent buggy:<name>] [--out <file>]",
      "",
      "Examples:",
      "  access-agent-eval run --model anthropic/claude-3.7-sonnet",
      "  access-agent-eval run --agent buggy:never-revoke",
      "",
      `Buggy agents (no API key needed): ${Object.keys(BUGGY)
        .map((n) => `buggy:${n}`)
        .join(", ")}`,
    ].join("\n")
  );
}

function selectAgent(args: string[]): AccessAgent {
  const agentFlag = getFlag(args, "agent");
  if (agentFlag) {
    const name = agentFlag.replace(/^buggy:/, "");
    const agent = BUGGY[name];
    if (!agent) {
      throw new Error(
        `Unknown agent "${agentFlag}". Available: ${Object.keys(BUGGY)
          .map((n) => `buggy:${n}`)
          .join(", ")}`
      );
    }
    return agent;
  }
  const model = getFlag(args, "model") ?? "anthropic/claude-3.7-sonnet";
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Export it, or use --agent buggy:<name> to try the harness without an LLM."
    );
  }
  return createLLMAgent({ model });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd !== "run") {
    usage();
    process.exit(cmd ? 1 : 0);
  }

  const agent = selectAgent(args);
  const model = getFlag(args, "model");
  const out = getFlag(args, "out") ?? "scorecard.json";

  console.log(`Running ${scenarios.length} scenarios against ${agent.name}...\n`);
  const results = await runScenarios(agent, scenarios);
  const scorecard = buildScorecard(agent.name, model, results);

  console.log(renderScorecard(scorecard));

  await writeFile(out, JSON.stringify(scorecard, null, 2), "utf8");
  console.log(`\nDetailed scorecard written to ${out}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
