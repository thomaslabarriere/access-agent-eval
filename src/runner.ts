import {
  AccessAgent,
  Scenario,
  ScenarioResult,
  StateDiff,
} from "./types.js";
import { cloneState } from "./admin/state.js";
import { applyActions } from "./admin/actions.js";
import { diffState } from "./admin/snapshot.js";
import { evaluateScenario } from "./eval/evaluate.js";

const EMPTY_DIFF: StateDiff = {
  grantsAdded: [],
  grantsRemoved: [],
  licensesAssigned: [],
  licensesReclaimed: [],
  usersTouched: [],
  noChange: true,
};

/** A synthetic result for a scenario whose agent run threw (API error, etc.). */
function errorResult(scenario: Scenario, err: unknown): ScenarioResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    scenarioId: scenario.id,
    title: scenario.title,
    passed: false,
    failures: ["agent_error"],
    applicableMetrics: ["agent_error"],
    anomalies: [],
    trace: {
      request: scenario.request,
      actions: [],
      diff: EMPTY_DIFF,
      finalMessage: `ERROR: ${message}`,
    },
  };
}

/**
 * Run one scenario against an agent and evaluate it.
 * The agent sees a clone of the initial state (read-only for it); the observed
 * "after" state is computed by applying the agent's actions to a fresh clone,
 * so the verdict comes from the real state diff, not the agent's prose.
 *
 * A thrown agent run is captured as an `agent_error` result, never propagated —
 * one failing scenario (or model) must not sink the rest of the run.
 */
export async function runScenario(
  agent: AccessAgent,
  scenario: Scenario,
): Promise<ScenarioResult> {
  try {
    const before = cloneState(scenario.initialState);
    const agentView = cloneState(scenario.initialState);

    const run = await agent.run({ request: scenario.request, state: agentView });

    const after = cloneState(scenario.initialState);
    applyActions(after, run.actions);
    const diff = diffState(before, after);

    return evaluateScenario(scenario, run, diff);
  } catch (err) {
    return errorResult(scenario, err);
  }
}

export async function runScenarios(
  agent: AccessAgent,
  scenarios: Scenario[],
): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(agent, scenario));
  }
  return results;
}
