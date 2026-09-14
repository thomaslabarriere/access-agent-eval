import { chromium, type Browser, type Page } from "playwright";
import { AccessAgent, Scenario, ScenarioResult, StateDiff } from "../types.js";
import { cloneState } from "../admin/state.js";
import { diffState } from "../admin/snapshot.js";
import { evaluateScenario } from "../eval/evaluate.js";
import { loadAndSeed, readState } from "./dom.js";
import { makeBrowserAgent, BROWSER_POLICIES } from "./browserAgents.js";

const EMPTY_DIFF: StateDiff = {
  grantsAdded: [],
  grantsRemoved: [],
  licensesAssigned: [],
  licensesReclaimed: [],
  usersTouched: [],
  noChange: true,
};

function errorResult(scenario: Scenario, err: unknown): ScenarioResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    scenarioId: scenario.id,
    title: scenario.title,
    passed: false,
    failures: ["agent_error"],
    applicableMetrics: ["agent_error"],
    anomalies: [],
    trace: {
      request: scenario.request,
      actions: [],
      diff: EMPTY_DIFF,
      finalMessage: `ERROR: ${message}`,
    },
  };
}

/**
 * Run one scenario against a browser agent operating the real UI.
 * The agent drives the DOM; the observed "after" state is READ BACK FROM THE
 * PAGE (not computed from the agent's action list), so the verdict comes from
 * what the console actually holds. This is the only difference from the
 * in-memory runner — diffState and evaluateScenario are reused unchanged.
 */
export async function runBrowserScenario(
  page: Page,
  agent: AccessAgent,
  scenario: Scenario,
): Promise<ScenarioResult> {
  try {
    const before = cloneState(scenario.initialState);
    await loadAndSeed(page, scenario.initialState);

    const run = await agent.run({
      request: scenario.request,
      state: cloneState(scenario.initialState),
    });

    const after = await readState(page); // real world state, from the DOM
    const diff = diffState(before, after);
    return evaluateScenario(scenario, run, diff);
  } catch (err) {
    return errorResult(scenario, err);
  }
}

export interface BrowserRunOptions {
  policyName: string;
  scenarios: Scenario[];
  /** Record a .webm of the whole run into this dir (one video for the session). */
  videoDir?: string;
}

export interface BrowserRunResult {
  agentName: string;
  results: ScenarioResult[];
  videoPath?: string;
}

/** Launch Chromium once, run every scenario against the chosen browser policy. */
export async function runBrowserScenarios(
  opts: BrowserRunOptions,
): Promise<BrowserRunResult> {
  const policy = BROWSER_POLICIES[opts.policyName];
  if (!policy) {
    throw new Error(
      `Unknown browser agent "browser:${opts.policyName}". Available: ${Object.keys(BROWSER_POLICIES)
        .map((n) => `browser:${n}`)
        .join(", ")}`,
    );
  }

  const browser: Browser = await chromium.launch();
  const context = await browser.newContext(
    opts.videoDir
      ? { recordVideo: { dir: opts.videoDir, size: { width: 1100, height: 720 } } }
      : {},
  );
  const page = await context.newPage();
  await page.setViewportSize({ width: 1100, height: 720 });

  const agent = makeBrowserAgent(page, policy);
  const results: ScenarioResult[] = [];
  for (const scenario of opts.scenarios) {
    results.push(await runBrowserScenario(page, agent, scenario));
  }

  const video = page.video();
  await context.close(); // flushes the video file
  const videoPath = video ? await video.path() : undefined;
  await browser.close();

  return { agentName: agent.name, results, videoPath };
}
