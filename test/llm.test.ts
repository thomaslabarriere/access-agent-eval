import { describe, it, expect } from "vitest";
import type OpenAI from "openai";
import { createLLMAgent, type ChatClient } from "../src/agent/runAgent.js";
import { runScenario } from "../src/runner.js";
import { scenarios } from "../src/scenarios/scenarios.js";

// ---------------------------------------------------------------------------
// LLM-path stub tests: exercise createLLMAgent with an INJECTED fake client so
// they run with zero API credits and no network, keeping the offline default.
// ---------------------------------------------------------------------------

/** Build a minimal, well-typed ChatCompletion carrying the given tool calls + text. */
function completion(
  toolCalls: { name: string; arguments: string }[],
  content: string,
): OpenAI.Chat.Completions.ChatCompletion {
  return {
    id: "cmpl_test",
    created: 0,
    model: "fake-model",
    object: "chat.completion",
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        logprobs: null,
        message: {
          role: "assistant",
          content,
          refusal: null,
          tool_calls: toolCalls.map((tc, i) => ({
            id: `call_${i}`,
            type: "function",
            function: { name: tc.name, arguments: tc.arguments },
          })),
        },
      },
    ],
  };
}

/** A fake client whose create() resolves with a canned completion. */
function fakeClient(result: OpenAI.Chat.Completions.ChatCompletion): ChatClient {
  return {
    chat: {
      completions: {
        create: async () => result,
      },
    },
  };
}

/** A fake client whose create() always throws — simulates an API failure. */
function throwingClient(): ChatClient {
  return {
    chat: {
      completions: {
        create: async () => {
          throw new Error("simulated API outage");
        },
      },
    },
  };
}

const revokeScenario = scenarios.find((s) => s.id === "revoke-departed")!;

describe("createLLMAgent — happy path turns tool calls into typed actions", () => {
  it("maps returned tool calls into AgentActions and captures the message", async () => {
    const agent = createLLMAgent({
      model: "fake-model",
      client: fakeClient(
        completion(
          [{ name: "revokeAccess", arguments: '{"userId":"u_jmartin","app":"crm"}' }],
          "Revoked CRM access.",
        ),
      ),
    });
    const run = await agent.run({
      request: revokeScenario.request,
      state: revokeScenario.initialState,
    });
    expect(run.actions).toEqual([
      { type: "revokeAccess", userId: "u_jmartin", app: "crm" },
    ]);
    expect(run.finalMessage).toBe("Revoked CRM access.");
  });

  it("silently drops a malformed tool call rather than fabricating an action", async () => {
    const agent = createLLMAgent({
      model: "fake-model",
      client: fakeClient(
        completion(
          [{ name: "grantAccess", arguments: "{not valid json" }],
          "Granted.",
        ),
      ),
    });
    const run = await agent.run({
      request: revokeScenario.request,
      state: revokeScenario.initialState,
    });
    expect(run.actions).toEqual([]);
  });
});

describe("createLLMAgent — fail-open: an API error never fabricates a grant", () => {
  it("propagates the error so the runner isolates it as agent_error with no state change", async () => {
    const agent = createLLMAgent({ model: "fake-model", client: throwingClient() });
    const result = await runScenario(agent, revokeScenario);
    // Degrades safely: recorded as agent_error, not a silent pass.
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("agent_error");
    // Crucially: no fabricated grants/revokes — nothing changed.
    expect(result.trace.diff.noChange).toBe(true);
    expect(result.trace.diff.grantsAdded).toHaveLength(0);
    expect(result.trace.actions).toHaveLength(0);
  });

  it("agent.run itself rejects when the injected client throws", async () => {
    const agent = createLLMAgent({ model: "fake-model", client: throwingClient() });
    await expect(
      agent.run({ request: revokeScenario.request, state: revokeScenario.initialState }),
    ).rejects.toThrow("simulated API outage");
  });
});
