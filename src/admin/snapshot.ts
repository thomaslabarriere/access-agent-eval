import { AdminState, Role, StateDiff, UserId } from "../types.js";

/** Sort helper: order by userId, then app. */
function byUserThenApp(
  a: { userId: UserId; app: string },
  b: { userId: UserId; app: string }
): number {
  if (a.userId !== b.userId) return a.userId < b.userId ? -1 : 1;
  if (a.app !== b.app) return a.app < b.app ? -1 : 1;
  return 0;
}

/**
 * Compute the StateDiff between two admin states. Users are matched by id.
 * Only users present in `after` are inspected for additions/assignments;
 * users present in `before` are inspected for removals/reclaims. Deterministic:
 * every output array is sorted by userId then app.
 */
export function diffState(before: AdminState, after: AdminState): StateDiff {
  const grantsAdded: { userId: UserId; app: string; role: Role }[] = [];
  const grantsRemoved: { userId: UserId; app: string }[] = [];
  const licensesAssigned: { userId: UserId; app: string }[] = [];
  const licensesReclaimed: { userId: UserId; app: string }[] = [];

  const beforeById = new Map(before.users.map((u) => [u.id, u]));
  const afterById = new Map(after.users.map((u) => [u.id, u]));

  // Grants added / upgraded: in `after`, an (app->role) pair that differs from before.
  for (const afterUser of after.users) {
    const beforeUser = beforeById.get(afterUser.id);
    for (const access of afterUser.access) {
      const prior = beforeUser?.access.find((a) => a.app === access.app);
      if (!prior || prior.role !== access.role) {
        grantsAdded.push({
          userId: afterUser.id,
          app: access.app,
          role: access.role,
        });
      }
    }
  }

  // Grants removed: in `before`, absent from `after`.
  for (const beforeUser of before.users) {
    const afterUser = afterById.get(beforeUser.id);
    for (const access of beforeUser.access) {
      const stillThere = afterUser?.access.some((a) => a.app === access.app);
      if (!stillThere) {
        grantsRemoved.push({ userId: beforeUser.id, app: access.app });
      }
    }
  }

  // Licenses assigned: assigned flipped false -> true.
  for (const afterUser of after.users) {
    const beforeUser = beforeById.get(afterUser.id);
    for (const license of afterUser.licenses) {
      if (!license.assigned) continue;
      const prior = beforeUser?.licenses.find((l) => l.app === license.app);
      const wasAssigned = prior?.assigned ?? false;
      if (!wasAssigned) {
        licensesAssigned.push({ userId: afterUser.id, app: license.app });
      }
    }
  }

  // Licenses reclaimed: assigned flipped true -> false.
  for (const beforeUser of before.users) {
    const afterUser = afterById.get(beforeUser.id);
    for (const license of beforeUser.licenses) {
      if (!license.assigned) continue;
      const now = afterUser?.licenses.find((l) => l.app === license.app);
      // Reclaimed when the license still exists but is no longer assigned.
      if (now && !now.assigned) {
        licensesReclaimed.push({ userId: beforeUser.id, app: license.app });
      }
    }
  }

  grantsAdded.sort(byUserThenApp);
  grantsRemoved.sort(byUserThenApp);
  licensesAssigned.sort(byUserThenApp);
  licensesReclaimed.sort(byUserThenApp);

  const touched = new Set<UserId>();
  for (const g of grantsAdded) touched.add(g.userId);
  for (const g of grantsRemoved) touched.add(g.userId);
  for (const l of licensesAssigned) touched.add(l.userId);
  for (const l of licensesReclaimed) touched.add(l.userId);

  const usersTouched = [...touched].sort((a, b) =>
    a === b ? 0 : a < b ? -1 : 1
  );

  const noChange =
    grantsAdded.length === 0 &&
    grantsRemoved.length === 0 &&
    licensesAssigned.length === 0 &&
    licensesReclaimed.length === 0;

  return {
    grantsAdded,
    grantsRemoved,
    licensesAssigned,
    licensesReclaimed,
    usersTouched,
    noChange,
  };
}
