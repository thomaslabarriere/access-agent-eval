import type { AccessAgent, AdminState, AgentAction, User } from "../types.js";

// ---------------------------------------------------------------------------
// Deterministic, LLM-free "buggy" agents. Each one exhibits exactly ONE failure
// mode so the evaluator's mutation-proof tests can prove that failure is caught.
// The heuristics are intentionally dumb (string matching / first-user picks).
// ---------------------------------------------------------------------------

/** First user mentioned by name/email/id in the request, else the first user. */
function firstMentionedUser(request: string, state: AdminState): User | undefined {
  const lower = request.toLowerCase();
  const mentioned = state.users.find(
    (u) =>
      lower.includes(u.id.toLowerCase()) ||
      lower.includes(u.name.toLowerCase()) ||
      lower.includes(u.email.toLowerCase())
  );
  return mentioned ?? state.users[0];
}

/** Very rough app guess: pick the first app-looking word, else "app". */
function guessApp(request: string, user: User | undefined): string {
  if (user && user.access[0]) {
    return user.access[0].app;
  }
  const match = request.match(/\b([A-Z][A-Za-z0-9]+|[a-z]+(?:hub|db|ops|CRM))\b/);
  return match?.[1] ?? "app";
}

function isRevokeRequest(request: string): boolean {
  return /\b(revoke|remove|offboard|depart|terminate|deactivate|disable)\b/i.test(request);
}

/**
 * FAILURE MODE: missed_revoke + confirmation_hallucination.
 * Claims the revoke happened but performs no action at all.
 */
export const neverActuallyRevokesAgent: AccessAgent = {
  name: "buggy:never-revoke",
  async run({ request }) {
    if (isRevokeRequest(request)) {
      return { actions: [], finalMessage: "Done, access revoked." };
    }
    return { actions: [], finalMessage: "Nothing to do." };
  },
};

/**
 * FAILURE MODE: over_grant / unsafe_privilege.
 * Always grants role "admin" for any grant-type request.
 */
export const overGrantsAdminAgent: AccessAgent = {
  name: "buggy:over-grant-admin",
  async run({ request, state }) {
    const user = firstMentionedUser(request, state);
    if (!user) {
      return { actions: [], finalMessage: "No users." };
    }
    const app = guessApp(request, user);
    const action: AgentAction = {
      type: "grantAccess",
      userId: user.id,
      app,
      role: "admin",
    };
    return { actions: [action], finalMessage: `Granted admin on ${app} to ${user.name}.` };
  },
};

/**
 * FAILURE MODE: wrong_target.
 * Always acts on state.users[0], ignoring whoever the request actually names.
 */
export const wrongTargetAgent: AccessAgent = {
  name: "buggy:wrong-target",
  async run({ request, state }) {
    const target = state.users[0];
    if (!target) {
      return { actions: [], finalMessage: "No users." };
    }
    const app = guessApp(request, target);
    if (isRevokeRequest(request)) {
      const action: AgentAction = { type: "revokeAccess", userId: target.id, app };
      return { actions: [action], finalMessage: `Revoked ${app} for ${target.name}.` };
    }
    // Grant "write" (not "read"): on a target who may already hold read-level
    // access, this guarantees an observable state change on the WRONG user,
    // so the wrong-target failure is exercised rather than silently no-op'ing.
    const action: AgentAction = {
      type: "grantAccess",
      userId: target.id,
      app,
      role: "write",
    };
    return { actions: [action], finalMessage: `Granted write on ${app} to ${target.name}.` };
  },
};

/**
 * FAILURE MODE: acted_on_ambiguous.
 * Always performs a grant, even when the request is ambiguous and should have
 * triggered askClarification.
 */
export const actsOnAmbiguousAgent: AccessAgent = {
  name: "buggy:acts-on-ambiguous",
  async run({ request, state }) {
    const user = firstMentionedUser(request, state);
    if (!user) {
      return { actions: [], finalMessage: "No users." };
    }
    const app = guessApp(request, user);
    const action: AgentAction = {
      type: "grantAccess",
      userId: user.id,
      app,
      role: "write",
    };
    return { actions: [action], finalMessage: `Granted write on ${app} to ${user.name}.` };
  },
};

/**
 * CONTROL (should PASS the revoke scenario).
 * Correctly revokes ALL access of the departed user named in the request.
 */
export const perfectRevokeAgent: AccessAgent = {
  name: "buggy:perfect-revoke",
  async run({ request, state }) {
    const user = firstMentionedUser(request, state);
    if (!user) {
      return { actions: [], finalMessage: "No matching user found." };
    }
    const actions: AgentAction[] = user.access.map((a) => ({
      type: "revokeAccess",
      userId: user.id,
      app: a.app,
    }));
    if (actions.length === 0) {
      return {
        actions: [{ type: "noop", reason: `${user.name} has no access to revoke.` }],
        finalMessage: `${user.name} already has no access.`,
      };
    }
    return {
      actions,
      finalMessage: `Revoked all ${actions.length} access grant(s) for ${user.name}.`,
    };
  },
};
