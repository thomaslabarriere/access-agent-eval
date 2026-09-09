import { AccessAgent, Scenario, ScenarioResult } from "./types.js";
import { cloneState } from "./admin/state.js";
import { applyActions } from "./admin/actions.js";
import { diffState } from "./admin/snapshot.js";
import { evaluateScenario } from "./eval/evaluate.js";

/**
 * Run one scenario against an agent and evaluate it.
 * The agent sees a clone of the initial state (read-only for it); the observed
 * "after" state is computed by applying the agent's actions to a fresh clone,
 * so the verdict comes from the real state diff, not the agent's prose.
 */
export async function runScenario(
  agent: AccessAgent,
  scenario: Scenario
): Promise<ScenarioResult> {
  const before = cloneState(scenario.initialState);
  const agentView = cloneState(scenario.initialState);

  const run = await agent.run({ request: scenario.request, state: agentView });

  const after = cloneState(scenario.initialState);
  applyActions(after, run.actions);
  const diff = diffState(before, after);

  return evaluateScenario(scenario, run, diff);
}

export async function runScenarios(
  agent: AccessAgent,
  scenarios: Scenario[]
): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(agent, scenario));
  }
  return results;
}
