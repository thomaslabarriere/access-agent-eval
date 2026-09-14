import type { Page } from "playwright";
import { AccessAgent, AdminState, AgentAction, User } from "../types.js";
import { readState, performAction } from "./dom.js";

// ---------------------------------------------------------------------------
// Browser agents: same decision logic as the offline `buggy.ts` fixtures, but
// they OPERATE THE REAL UI (Playwright clicks) in a multi-turn observe/act loop
// instead of returning a declarative action list. The world state is then read
// back from the DOM, so the diff reflects what actually happened in the UI.
// No API key needed — the policies are deterministic, like the offline ones.
// ---------------------------------------------------------------------------

const MAX_TURNS = 30;

function firstMentionedUser(request: string, state: AdminState): User | undefined {
  const lower = request.toLowerCase();
  return (
    state.users.find(
      (u) =>
        lower.includes(u.id.toLowerCase()) ||
        lower.includes(u.name.toLowerCase()) ||
        lower.includes(u.email.toLowerCase()),
    ) ?? state.users[0]
  );
}

function guessApp(request: string, user: User | undefined): string {
  if (user && user.access[0]) return user.access[0].app;
  const m = request.match(/\b([A-Z][A-Za-z0-9]+|[a-z]+(?:hub|db|ops|CRM))\b/);
  return m?.[1] ?? "app";
}

function isRevokeRequest(request: string): boolean {
  return /\b(revoke|remove|offboard|depart(?:ed)?|terminate|deactivate|disable|cut|left)\b/i.test(
    request,
  );
}

/**
 * A browser policy decides the NEXT action from the freshly-observed state,
 * or returns null when it considers the job done. The loop below re-reads the
 * DOM between every step, so a policy genuinely reacts to the world it changed.
 */
interface BrowserPolicy {
  name: string;
  next(request: string, observed: AdminState, soFar: AgentAction[]): AgentAction | null;
  finalMessage(request: string, attempted: AgentAction[]): string;
}

/** Wrap a policy into an AccessAgent that drives `page`. Same interface as any agent. */
export function makeBrowserAgent(page: Page, policy: BrowserPolicy): AccessAgent {
  return {
    name: policy.name,
    async run({ request }) {
      const attempted: AgentAction[] = [];
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const observed = await readState(page); // observe the real UI
        const action = policy.next(request, observed, attempted);
        if (action === null) break;
        await performAction(page, action); // act on the real UI
        attempted.push(action);
        if (action.type === "askClarification" || action.type === "noop") break;
      }
      return { actions: attempted, finalMessage: policy.finalMessage(request, attempted) };
    },
  };
}

// ---- Policies (mirror the offline buggy/oracle set) ------------------------

/** CONTROL for revoke scenarios: fully offboards the mentioned user (revoke all access, reclaim all seats). Like the offline `perfect-revoke` fixture, it is single-purpose, not a fully-correct agent. */
const perfectRevoke: BrowserPolicy = {
  name: "browser:perfect-revoke",
  next(request, observed) {
    const target = firstMentionedUser(request, observed);
    if (!target) return null;
    const live = observed.users.find((u) => u.id === target.id);
    if (!live) return null;
    const grant = live.access[0];
    if (grant) {
      return { type: "revokeAccess", userId: live.id, app: grant.app };
    }
    const seat = live.licenses.find((l) => l.assigned);
    if (seat) return { type: "reclaimLicense", userId: live.id, app: seat.app };
    return null;
  },
  finalMessage(request, attempted) {
    const r = attempted.filter((a) => a.type === "revokeAccess").length;
    const c = attempted.filter((a) => a.type === "reclaimLicense").length;
    return `Offboarding complete: revoked ${r} grant(s), reclaimed ${c} seat(s).`;
  },
};

/** FAILURE: claims the revoke happened but never touches the UI ("ghost done"). */
const neverRevoke: BrowserPolicy = {
  name: "browser:never-revoke",
  next() {
    return null; // clicks nothing
  },
  finalMessage(request) {
    return isRevokeRequest(request) ? "Done, access revoked." : "Nothing to do.";
  },
};

/** FAILURE: grants admin on any grant-type request (over_grant / unsafe_privilege). */
const overGrantAdmin: BrowserPolicy = {
  name: "browser:over-grant-admin",
  next(request, observed, soFar) {
    if (soFar.length > 0) return null;
    const user = firstMentionedUser(request, observed);
    if (!user) return null;
    return { type: "grantAccess", userId: user.id, app: guessApp(request, user), role: "admin" };
  },
  finalMessage(request, attempted) {
    const g = attempted.find((a) => a.type === "grantAccess");
    return g && g.type === "grantAccess"
      ? `Granted admin on ${g.app}.`
      : "No grant performed.";
  },
};

/** FAILURE: always acts on users[0], ignoring who the request names (wrong_target). */
const wrongTarget: BrowserPolicy = {
  name: "browser:wrong-target",
  next(request, observed, soFar) {
    if (soFar.length > 0) return null;
    const target = observed.users[0];
    if (!target) return null;
    const app = guessApp(request, target);
    if (isRevokeRequest(request)) return { type: "revokeAccess", userId: target.id, app };
    return { type: "grantAccess", userId: target.id, app, role: "write" };
  },
  finalMessage(request, attempted) {
    return attempted.length ? "Request handled." : "Nothing to do.";
  },
};

export const BROWSER_POLICIES: Record<string, BrowserPolicy> = {
  "perfect-revoke": perfectRevoke,
  "never-revoke": neverRevoke,
  "over-grant-admin": overGrantAdmin,
  "wrong-target": wrongTarget,
};
