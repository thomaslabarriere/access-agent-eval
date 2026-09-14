import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Page } from "playwright";
import { AdminState, AgentAction } from "../types.js";

// `window` is referenced only inside page.evaluate/waitForFunction callbacks,
// which execute in the browser, not in Node. Declare it locally so this
// Node-target module type-checks without pulling the DOM lib repo-wide.
declare const window: Record<string, unknown>;

const HERE = dirname(fileURLToPath(import.meta.url));
// Resolve the UI whether we run from src/ (tsx) or dist/ (built): the HTML is
// copied next to the compiled file at build time, and lives next to it in src.
export const ADMIN_UI_URL = `file://${join(HERE, "admin-ui.html")}`;

/** Load the mock admin console and seed it with the scenario's initial state. */
export async function loadAndSeed(page: Page, state: AdminState): Promise<void> {
  await page.goto(ADMIN_UI_URL);
  await page.waitForFunction(() => typeof (window as unknown as { __seed?: unknown }).__seed === "function");
  await page.evaluate((s) => (window as unknown as { __seed: (x: unknown) => void }).__seed(s), state);
  await page.waitForSelector("[data-user-row]");
}

/**
 * Read the CURRENT world state from the page. This is the whole point of the
 * browser harness: the verdict is computed from what the UI actually holds
 * after the agent operated it, not from any list of actions the agent claims.
 */
export async function readState(page: Page): Promise<AdminState> {
  return page.evaluate(
    () => (window as unknown as { __readState: () => AdminState }).__readState(),
  );
}

function sel(act: string, userId: string, app?: string): string {
  const base = `[data-act="${act}"][data-user="${cssEscape(userId)}"]`;
  return app === undefined ? base : `${base}[data-app="${cssEscape(app)}"]`;
}

/** Minimal CSS attribute-value escaping for ids/apps used in selectors. */
function cssEscape(v: string): string {
  return v.replace(/["\\]/g, "\\$&");
}

/**
 * Perform ONE agent action by operating the real UI (clicks / typing), exactly
 * as a human admin or a browser agent would. Returns true if the control was
 * present and actuated; false if the agent tried to click something that does
 * not exist (e.g. revoke on an app the user never had) — a "ghost click" that
 * leaves the world unchanged and is caught by the diff.
 */
export async function performAction(page: Page, action: AgentAction): Promise<boolean> {
  switch (action.type) {
    case "revokeAccess": {
      const el = page.locator(sel("revoke", action.userId, action.app));
      if ((await el.count()) === 0) return false;
      await el.first().click();
      return true;
    }
    case "reclaimLicense": {
      const el = page.locator(sel("reclaim", action.userId, action.app));
      if ((await el.count()) === 0) return false;
      await el.first().click();
      return true;
    }
    case "assignLicense": {
      const el = page.locator(sel("assign", action.userId, action.app));
      if ((await el.count()) === 0) return false;
      await el.first().click();
      return true;
    }
    case "grantAccess": {
      const appInput = page.locator(sel("grant-app", action.userId));
      const roleSel = page.locator(sel("grant-role", action.userId));
      const btn = page.locator(sel("grant", action.userId));
      if ((await btn.count()) === 0) return false;
      await appInput.first().fill(action.app);
      await roleSel.first().selectOption(action.role);
      await btn.first().click();
      return true;
    }
    case "askClarification":
    case "noop":
      // No world-changing control to click; the intent lives in finalMessage.
      return true;
  }
}
