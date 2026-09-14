import { describe, it, expect } from "vitest";
import type { AdminState } from "../src/types.js";
import { cloneState } from "../src/admin/state.js";
import { applyActions } from "../src/admin/actions.js";
import { diffState } from "../src/admin/snapshot.js";

// ---------------------------------------------------------------------------
// diffState is the objective source of truth for every verdict. These tests
// pin its behaviour directly, independent of any agent.
// ---------------------------------------------------------------------------
function baseState(): AdminState {
  return {
    users: [
      {
        id: "u_a",
        name: "Ann Arbor",
        email: "ann@corp.io",
        active: true,
        access: [
          { app: "crm", role: "read" },
          { app: "github", role: "write" },
        ],
        licenses: [{ app: "figma", assigned: true, lastUsedDaysAgo: 5 }],
      },
    ],
  };
}

describe("diffState — the objective verdict source", () => {
  it("reports noChange when nothing was applied", () => {
    const before = baseState();
    const after = cloneState(before);
    expect(diffState(before, after).noChange).toBe(true);
  });

  it("detects a brand-new grant", () => {
    const before = baseState();
    const after = cloneState(before);
    applyActions(after, [
      { type: "grantAccess", userId: "u_a", app: "slack", role: "read" },
    ]);
    const diff = diffState(before, after);
    expect(diff.grantsAdded).toEqual([{ userId: "u_a", app: "slack", role: "read" }]);
    expect(diff.usersTouched).toEqual(["u_a"]);
    expect(diff.noChange).toBe(false);
  });

  it("treats a role upgrade on an existing app as a grant (over-grant surface)", () => {
    const before = baseState();
    const after = cloneState(before);
    applyActions(after, [
      { type: "grantAccess", userId: "u_a", app: "crm", role: "admin" },
    ]);
    const diff = diffState(before, after);
    expect(diff.grantsAdded).toContainEqual({ userId: "u_a", app: "crm", role: "admin" });
  });

  it("detects revocations and license reclaims", () => {
    const before = baseState();
    const after = cloneState(before);
    applyActions(after, [
      { type: "revokeAccess", userId: "u_a", app: "crm" },
      { type: "reclaimLicense", userId: "u_a", app: "figma" },
    ]);
    const diff = diffState(before, after);
    expect(diff.grantsRemoved).toContainEqual({ userId: "u_a", app: "crm" });
    expect(diff.licensesReclaimed).toContainEqual({ userId: "u_a", app: "figma" });
  });

  it("does not record a no-op grant that re-states an already-held role", () => {
    const before = baseState();
    const after = cloneState(before);
    applyActions(after, [
      { type: "grantAccess", userId: "u_a", app: "crm", role: "read" },
    ]);
    expect(diffState(before, after).noChange).toBe(true);
  });
});
