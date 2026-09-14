import { describe, it, expect } from "vitest";
import { parseToolCall } from "../src/agent/tools.js";

// ---------------------------------------------------------------------------
// parseToolCall is the pure LLM-output parser. It runs with zero API credits
// and must be robust to whatever a model emits: valid JSON, malformed JSON,
// unknown tools, and missing/invalid arguments.
// ---------------------------------------------------------------------------
describe("parseToolCall — valid tool calls", () => {
  it("parses a well-formed grantAccess", () => {
    expect(
      parseToolCall("grantAccess", '{"userId":"u_a","app":"crm","role":"read"}'),
    ).toEqual({ type: "grantAccess", userId: "u_a", app: "crm", role: "read" });
  });

  it("parses revoke / assign / reclaim / ask / noop", () => {
    expect(parseToolCall("revokeAccess", '{"userId":"u_a","app":"crm"}')).toEqual({
      type: "revokeAccess",
      userId: "u_a",
      app: "crm",
    });
    expect(parseToolCall("assignLicense", '{"userId":"u_a","app":"figma"}')).toEqual({
      type: "assignLicense",
      userId: "u_a",
      app: "figma",
    });
    expect(parseToolCall("reclaimLicense", '{"userId":"u_a","app":"figma"}')).toEqual({
      type: "reclaimLicense",
      userId: "u_a",
      app: "figma",
    });
    expect(parseToolCall("askClarification", '{"question":"which app?"}')).toEqual({
      type: "askClarification",
      question: "which app?",
    });
    expect(parseToolCall("noop", '{"reason":"already satisfied"}')).toEqual({
      type: "noop",
      reason: "already satisfied",
    });
  });
});

describe("parseToolCall — malformed / invalid input returns null (never a fabricated action)", () => {
  it("returns null on malformed JSON", () => {
    expect(parseToolCall("grantAccess", "{not json")).toBeNull();
    expect(parseToolCall("grantAccess", "")).toBeNull();
  });

  it("returns null on non-object JSON", () => {
    expect(parseToolCall("grantAccess", "42")).toBeNull();
    expect(parseToolCall("grantAccess", "null")).toBeNull();
    expect(parseToolCall("grantAccess", '"a string"')).toBeNull();
  });

  it("returns null on an unknown tool name", () => {
    expect(parseToolCall("deleteEverything", '{"userId":"u_a"}')).toBeNull();
  });

  it("returns null when required arguments are missing or wrong-typed", () => {
    expect(parseToolCall("grantAccess", '{"userId":"u_a","app":"crm"}')).toBeNull();
    expect(
      parseToolCall("grantAccess", '{"userId":"u_a","app":"crm","role":"superuser"}'),
    ).toBeNull();
    expect(parseToolCall("grantAccess", '{"userId":"","app":"crm","role":"read"}')).toBeNull();
    expect(parseToolCall("revokeAccess", '{"userId":123,"app":"crm"}')).toBeNull();
  });
});
