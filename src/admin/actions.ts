import { AdminState, AgentAction, License } from "../types.js";
import { findUser } from "./state.js";

/** Apply a single agent action to `state`, mutating it in place. */
export function applyAction(state: AdminState, action: AgentAction): void {
  switch (action.type) {
    case "grantAccess": {
      const user = findUser(state, action.userId);
      if (!user) return;
      const existing = user.access.find((a) => a.app === action.app);
      if (existing) {
        existing.role = action.role;
      } else {
        user.access.push({ app: action.app, role: action.role });
      }
      return;
    }
    case "revokeAccess": {
      const user = findUser(state, action.userId);
      if (!user) return;
      user.access = user.access.filter((a) => a.app !== action.app);
      return;
    }
    case "assignLicense": {
      const user = findUser(state, action.userId);
      if (!user) return;
      const existing = user.licenses.find((l) => l.app === action.app);
      if (existing) {
        existing.assigned = true;
      } else {
        const license: License = {
          app: action.app,
          assigned: true,
          lastUsedDaysAgo: null,
        };
        user.licenses.push(license);
      }
      return;
    }
    case "reclaimLicense": {
      const user = findUser(state, action.userId);
      if (!user) return;
      const existing = user.licenses.find((l) => l.app === action.app);
      if (existing) {
        existing.assigned = false;
      }
      return;
    }
    case "askClarification":
    case "noop":
      return;
  }
}

/** Apply a sequence of actions in order, mutating `state` in place. */
export function applyActions(state: AdminState, actions: AgentAction[]): void {
  for (const action of actions) {
    applyAction(state, action);
  }
}
