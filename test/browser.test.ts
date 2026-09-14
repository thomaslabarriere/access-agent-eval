import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { Scenario } from "../src/types.js";
import { loadAndSeed, readState, performAction } from "../src/browser/dom.js";
import { makeBrowserAgent, BROWSER_POLICIES } from "../src/browser/browserAgents.js";
import { runBrowserScenario } from "../src/browser/runner.js";

// A departed employee holding two grants (no licenses, so a correct offboard is
// exactly "revoke both" — keeps the oracle's expected pass clean).
const offboard: Scenario = {
  id: "T-offboard",
  title: "Offboard a departed employee",
  request: "Alex Martin left the company last week. Please revoke all their access.",
  initialState: {
    users: [
      {
        id: "u1",
        name: "Alex Martin",
        email: "alex.martin@acme.example",
        active: false,
        access: [
          { app: "GitHub", role: "admin" },
          { app: "CRM", role: "write" },
        ],
        licenses: [],
      },
    ],
  },
  expected: { mustRevokeAllAccessForUser: "u1" },
};

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

describe("mock admin UI is the source of truth", () => {
  it("readState reflects a real click, not a declared action", async () => {
    await loadAndSeed(page, offboard.initialState);
    expect((await readState(page)).users[0]!.access).toHaveLength(2);

    await performAction(page, { type: "revokeAccess", userId: "u1", app: "GitHub" });

    const after = await readState(page);
    expect(after.users[0]!.access.map((a) => a.app)).toEqual(["CRM"]);
  });

  it("a ghost click on a nonexistent control changes nothing", async () => {
    await loadAndSeed(page, offboard.initialState);
    const actuated = await performAction(page, {
      type: "revokeAccess",
      userId: "u1",
      app: "AppThatDoesNotExist",
    });
    expect(actuated).toBe(false);
    expect((await readState(page)).users[0]!.access).toHaveLength(2);
  });
});

describe("verdict comes from the DOM, not the agent's words", () => {
  it("browser:perfect-revoke actually offboards and passes", async () => {
    const agent = makeBrowserAgent(page, BROWSER_POLICIES["perfect-revoke"]!);
    const result = await runBrowserScenario(page, agent, offboard);

    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.trace.diff.grantsRemoved.map((g) => g.app).sort()).toEqual(["CRM", "GitHub"]);
    // The world (DOM) really is empty of access now.
    expect((await readState(page)).users[0]!.access).toHaveLength(0);
  });

  it('browser:never-revoke says "done" but is caught by the state diff', async () => {
    const agent = makeBrowserAgent(page, BROWSER_POLICIES["never-revoke"]!);
    const result = await runBrowserScenario(page, agent, offboard);

    expect(result.passed).toBe(false);
    expect(result.failures).toContain("missed_revoke");
    expect(result.failures).toContain("confirmation_hallucination");
    expect(result.trace.diff.noChange).toBe(true);
    expect(result.trace.finalMessage.toLowerCase()).toContain("revoked");
  });
});
