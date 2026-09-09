import { describe, it, expect } from "vitest";
import { Scenario } from "../src/types.js";
import { scenarios } from "../src/scenarios/scenarios.js";
import { runScenario } from "../src/runner.js";
import {
  neverActuallyRevokesAgent,
  overGrantsAdminAgent,
  wrongTargetAgent,
  actsOnAmbiguousAgent,
  perfectRevokeAgent,
} from "../src/agent/buggy.js";

function scenario(id: string): Scenario {
  const s = scenarios.find((sc) => sc.id === id);
  if (!s) throw new Error(`scenario ${id} not found`);
  return s;
}

// ---------------------------------------------------------------------------
// Mutation proof: each deliberately-broken agent must be caught by the harness
// on the metric it violates. If the harness could NOT catch these, it would be
// worthless — so these tests are what make the scorecard trustworthy.
// ---------------------------------------------------------------------------
describe("mutation proof — the harness catches broken agents", () => {
  it("catches a missed revocation (agent that claims success but does nothing)", async () => {
    const r = await runScenario(neverActuallyRevokesAgent, scenario("revoke-departed"));
    expect(r.passed).toBe(false);
    expect(r.failures).toContain("missed_revoke");
  });

  it("catches over-granting (agent that always grants admin)", async () => {
    const r = await runScenario(overGrantsAdminAgent, scenario("least-privilege"));
    expect(r.passed).toBe(false);
    expect(r.failures).toContain("over_grant");
  });

  it("catches the wrong target (homonym)", async () => {
    const r = await runScenario(wrongTargetAgent, scenario("homonym"));
    expect(r.passed).toBe(false);
    expect(r.failures).toContain("wrong_target");
  });

  it("catches acting on an ambiguous request instead of asking", async () => {
    const r = await runScenario(actsOnAmbiguousAgent, scenario("ambiguous-request"));
    expect(r.passed).toBe(false);
    expect(r.failures).toContain("acted_on_ambiguous");
  });
});

// ---------------------------------------------------------------------------
// Control: a correct agent must NOT be flagged on the same scenario — otherwise
// the harness would just fail everything (a false-positive machine).
// ---------------------------------------------------------------------------
describe("control — a correct agent is not falsely flagged", () => {
  it("does not flag missed_revoke when the departed user's access is fully revoked", async () => {
    const r = await runScenario(perfectRevokeAgent, scenario("revoke-departed"));
    expect(r.failures).not.toContain("missed_revoke");
  });
});
