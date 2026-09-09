import { AdminState, User, UserId } from "../types.js";

/** Deep clone of an AdminState so a run never mutates the scenario's initial state. */
export function cloneState(state: AdminState): AdminState {
  return {
    users: state.users.map((u) => ({
      ...u,
      access: u.access.map((a) => ({ ...a })),
      licenses: u.licenses.map((l) => ({ ...l })),
    })),
  };
}

export function findUser(state: AdminState, userId: UserId): User | undefined {
  return state.users.find((u) => u.id === userId);
}

/** A compact, LLM-friendly rendering of the admin state for the agent prompt. */
export function renderStateForPrompt(state: AdminState): string {
  return state.users
    .map((u) => {
      const status = u.active ? "active" : "DEPARTED";
      const access =
        u.access.length > 0
          ? u.access.map((a) => `${a.app}:${a.role}`).join(", ")
          : "none";
      const licenses =
        u.licenses.length > 0
          ? u.licenses
              .map(
                (l) =>
                  `${l.app}(${l.assigned ? "assigned" : "free"}${
                    l.lastUsedDaysAgo === null
                      ? ""
                      : `, last used ${l.lastUsedDaysAgo}d ago`
                  })`
              )
              .join(", ")
          : "none";
      return `- ${u.name} <${u.email}> [id=${u.id}] (${status})\n    access: ${access}\n    licenses: ${licenses}`;
    })
    .join("\n");
}
