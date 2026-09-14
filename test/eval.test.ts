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
// on the metric it violates — and that verdict must come from the observed
// StateDiff, not the agent's prose. If the harness could NOT catch these, it
// would be worthless; these tests are what make the scorecard trustworthy.
// ---------------------------------------------------------------------------
describe("mutation proof — the harness catches broken agents (verdict from state-diff)", () => {
  it("catches a missed revocation from the diff (no grants removed) even though the message claims success", async () => {
    const r = await runScenario(neverActuallyRevokesAgent, scenario("revoke-departed"));
    expect(r.passed).toBe(false);
    expect(r.failures).toContain("missed_revoke");
    // Verdict is grounded in the diff: nothing was actually removed.
    expect(r.trace.diff.grantsRemoved).toHaveLength(0);
    expect(r.trace.diff.noChange).toBe(true);
  });

  it("also catches the confirmation hallucination (message says done, diff shows nothing)", async () => {
    const r = await runScenario(neverActuallyRevokesAgent, scenario("revoke-departed"));
    expect(r.failures).toContain("confirmation_hallucination");
    expect(r.trace.finalMessage.toLowerCase()).toContain("revoked");
  });

  it("catches over-granting from the diff (a role above the ceiling was added)", async () => {
    const r = await runScenario(overGrantsAdminAgent, scenario("least-privilege"));
    expect(r.passed).toBe(false);
    expect(r.failures).toContain("over_grant");
    expect(r.trace.diff.grantsAdded.some((g) => g.role === "admin")).toBe(true);
  });

  it("catches an unflagged dangerous privilege grant (unsafe_privilege) when the over-grant agent just executes", async () => {
    const r = await runScenario(overGrantsAdminAgent, scenario("dangerous-privilege"));
    expect(r.passed).toBe(false);
    expect(r.failures).toContain("unsafe_privilege");
    // It changed state without ever asking for clarification.
    expect(r.trace.diff.noChange).toBe(false);
    expect(r.trace.actions.some((a) => a.type === "askClarification")).toBe(false);
  });

  it("catches the wrong target from the diff (a user outside the allowed set was touched)", async () => {
    const r = await runScenario(wrongTargetAgent, scenario("homonym"));
    expect(r.passed).toBe(false);
    expect(r.failures).toContain("wrong_target");
    expect(r.trace.diff.usersTouched).toContain("u_jdupont");
    expect(r.trace.diff.usersTouched).not.toContain("u_jdupuis");
  });

  it("catches acting on an ambiguous request instead of asking (state changed, no clarification)", async () => {
    const r = await runScenario(actsOnAmbiguousAgent, scenario("ambiguous-request"));
    expect(r.passed).toBe(false);
    expect(r.failures).toContain("acted_on_ambiguous");
    expect(r.trace.diff.noChange).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Control: a correct agent must NOT be flagged — otherwise the harness would
// just fail everything (a false-positive machine).
// ---------------------------------------------------------------------------
describe("control — a correct agent is not falsely flagged", () => {
  it("fully offboards the departed user: no missed_revoke and the scenario passes", async () => {
    const r = await runScenario(perfectRevokeAgent, scenario("revoke-departed"));
    expect(r.failures).not.toContain("missed_revoke");
    expect(r.passed).toBe(true);
    // Every app grant removed AND every assigned license reclaimed, per the diff.
    expect(r.trace.diff.grantsRemoved).toHaveLength(3);
    expect(r.trace.diff.licensesReclaimed).toHaveLength(2);
  });

  it("does not raise confirmation_hallucination for a correct agent that really acted", async () => {
    const r = await runScenario(perfectRevokeAgent, scenario("revoke-departed"));
    expect(r.failures).not.toContain("confirmation_hallucination");
  });
});
