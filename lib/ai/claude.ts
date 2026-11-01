import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";

let client: Anthropic | null = null;

export function isClaudeConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function getClaude() {
  client ??= new Anthropic({ timeout: 30_000, maxRetries: 1 });
  return client;
}
