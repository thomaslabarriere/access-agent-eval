import type OpenAI from "openai";
import type { AgentAction, Role } from "../types.js";

/**
 * OpenAI-compatible function-tool definitions describing the six actions the
 * access-management agent may take. Passed verbatim as `tools` to
 * chat.completions.create.
 */
export const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "grantAccess",
      description:
        "Grant a user a specific access role on an app. Use the LEAST privilege that satisfies the request. Only use when the request unambiguously asks to grant access to a specific, existing user.",
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "The exact user id (from the admin state) to grant access to.",
          },
          app: {
            type: "string",
            description: "The application to grant access on.",
          },
          role: {
            type: "string",
            enum: ["read", "write", "admin"],
            description:
              "The access role. Prefer 'read', then 'write'. Only use 'admin' when explicitly and unambiguously requested.",
          },
        },
        required: ["userId", "app", "role"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "revokeAccess",
      description:
        "Revoke a user's access on an app. For a departed/offboarded employee, revoke EVERY app they have access to (one call per app).",
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "The exact user id (from the admin state) to revoke access from.",
          },
          app: {
            type: "string",
            description: "The application to revoke access on.",
          },
        },
        required: ["userId", "app"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "assignLicense",
      description: "Assign an app license to a user.",
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "The exact user id (from the admin state) to assign the license to.",
          },
          app: {
            type: "string",
            description: "The application whose license is being assigned.",
          },
        },
        required: ["userId", "app"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reclaimLicense",
      description:
        "Reclaim (free) an app license currently assigned to a user, e.g. an unused seat.",
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "The exact user id (from the admin state) to reclaim the license from.",
          },
          app: {
            type: "string",
            description: "The application whose license is being reclaimed.",
          },
        },
        required: ["userId", "app"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "askClarification",
      description:
        "Ask a clarifying question INSTEAD of acting. Use whenever the request is ambiguous, under-specified, dangerous, or does not clearly identify the target user or action. Do not take any state-changing action in the same turn.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The clarifying question to ask the human operator.",
          },
        },
        required: ["question"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "noop",
      description:
        "Take no action. Use when the request is already satisfied by the current state, or when no action is appropriate.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Why no action was taken.",
          },
        },
        required: ["reason"],
        additionalProperties: false,
      },
    },
  },
];

const VALID_ROLES: readonly Role[] = ["read", "write", "admin"];

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (VALID_ROLES as readonly string[]).includes(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Parse a single tool call (name + raw JSON arguments) into a typed AgentAction.
 * Returns null if the tool name is unknown, the JSON is malformed, or the
 * arguments fail validation.
 */
export function parseToolCall(name: string, argsJson: string): AgentAction | null {
  let args: unknown;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return null;
  }
  if (typeof args !== "object" || args === null) {
    return null;
  }
  const a = args as Record<string, unknown>;

  switch (name) {
    case "grantAccess": {
      if (!isNonEmptyString(a.userId) || !isNonEmptyString(a.app) || !isRole(a.role)) {
        return null;
      }
      return { type: "grantAccess", userId: a.userId, app: a.app, role: a.role };
    }
    case "revokeAccess": {
      if (!isNonEmptyString(a.userId) || !isNonEmptyString(a.app)) {
        return null;
      }
      return { type: "revokeAccess", userId: a.userId, app: a.app };
    }
    case "assignLicense": {
      if (!isNonEmptyString(a.userId) || !isNonEmptyString(a.app)) {
        return null;
      }
      return { type: "assignLicense", userId: a.userId, app: a.app };
    }
    case "reclaimLicense": {
      if (!isNonEmptyString(a.userId) || !isNonEmptyString(a.app)) {
        return null;
      }
      return { type: "reclaimLicense", userId: a.userId, app: a.app };
    }
    case "askClarification": {
      if (!isNonEmptyString(a.question)) {
        return null;
      }
      return { type: "askClarification", question: a.question };
    }
    case "noop": {
      if (!isNonEmptyString(a.reason)) {
        return null;
      }
      return { type: "noop", reason: a.reason };
    }
    default:
      return null;
  }
}
