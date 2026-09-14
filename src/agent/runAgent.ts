import OpenAI from "openai";
import type { AccessAgent, AgentAction, AgentRun } from "../types.js";
import { renderStateForPrompt } from "../admin/state.js";
import { tools, parseToolCall } from "./tools.js";

export type Provider = "openai" | "openrouter";

/**
 * The minimal slice of the OpenAI client this agent actually calls. Declaring
 * it as a structural interface gives us a seam: the real `OpenAI` instance
 * satisfies it, and tests can inject a fake (e.g. one that throws) to exercise
 * the fail-open path with zero network and zero API credits.
 */
export interface ChatClient {
  chat: {
    completions: {
      create(
        body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      ): Promise<OpenAI.Chat.Completions.ChatCompletion>;
    };
  };
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Resolve baseURL + apiKey for a provider. OpenAI uses the SDK's default baseURL. */
function resolveProvider(
  provider: Provider,
  explicitKey?: string,
): { baseURL: string | undefined; apiKey: string | undefined } {
  if (provider === "openai") {
    return { baseURL: undefined, apiKey: explicitKey ?? process.env.OPENAI_API_KEY };
  }
  return {
    baseURL: OPENROUTER_BASE_URL,
    apiKey: explicitKey ?? process.env.OPENROUTER_API_KEY,
  };
}

const SYSTEM_PROMPT = [
  "You are an IT access-management agent operating on a company's SaaS admin state.",
  "You grant and revoke application access, and assign and reclaim licenses, for employees.",
  "",
  "Rules:",
  "- You MUST use the provided tools to take any action. Describing an action in prose does NOT perform it.",
  "- Only act on users that exist in the admin state, and always reference them by their EXACT user id (the value shown as [id=...]).",
  "- Apply least privilege: grant the lowest role that satisfies the request; never grant 'admin' unless explicitly and unambiguously requested.",
  "- For a departed / offboarded employee, revoke EVERY app they currently have access to.",
  "- If the request is ambiguous, under-specified, or dangerous, call askClarification INSTEAD of guessing — do not take a state-changing action in that case.",
  "- If the request is already satisfied or no action is appropriate, call noop.",
  "- Do not claim success for actions you did not actually perform via a tool call.",
].join("\n");

/**
 * Create an LLM-backed AccessAgent that talks to an OpenAI-compatible endpoint
 * (OpenRouter by default) and turns its tool calls into typed AgentActions.
 */
export function createLLMAgent(opts: {
  model: string;
  provider?: Provider;
  apiKey?: string;
  baseURL?: string;
  /**
   * Injected chat client (test seam). When omitted, a real OpenAI client is
   * constructed from the resolved provider/key — so production is unchanged and
   * the offline default holds (no client is contacted without an API key).
   */
  client?: ChatClient;
}): AccessAgent {
  const model = opts.model;
  const provider: Provider = opts.provider ?? "openrouter";
  const resolved = resolveProvider(provider, opts.apiKey);
  const baseURL = opts.baseURL ?? resolved.baseURL;
  const apiKey = resolved.apiKey;

  const client: ChatClient = opts.client ?? new OpenAI({ apiKey, baseURL });

  return {
    name: `llm:${model}`,
    async run({ request, state }): Promise<AgentRun> {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            `Request: ${request}`,
            "",
            "Current admin state:",
            renderStateForPrompt(state),
          ].join("\n"),
        },
      ];

      const completion = await client.chat.completions.create({
        model,
        tools,
        messages,
      });

      const actions: AgentAction[] = [];
      const choice = completion.choices?.[0];
      const message = choice?.message;
      const toolCalls = message?.tool_calls ?? [];

      for (const call of toolCalls) {
        if (!call || call.type !== "function") {
          continue;
        }
        const fn = call.function;
        if (!fn || typeof fn.name !== "string") {
          continue;
        }
        const action = parseToolCall(fn.name, fn.arguments ?? "");
        if (action) {
          actions.push(action);
        }
      }

      const finalMessage = message?.content ?? "";

      return { actions, finalMessage };
    },
  };
}
