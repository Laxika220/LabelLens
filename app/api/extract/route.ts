import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { NextResponse } from "next/server";
import { CLAUDE_MODEL, getClaude, isClaudeConfigured } from "@/lib/ai/claude";
import { EXTRACT_PROMPT_VERSION, EXTRACT_SYSTEM, EXTRACT_USER } from "@/lib/ai/prompts/extract.v1";
import { ExtractionSchema, ExtractRequestSchema, normaliseExtraction } from "@/lib/ai/schemas";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

// Images live only in this request's memory: they are never written to disk,
// logged, or forwarded anywhere except the Claude API call below.
export async function POST(req: Request) {
  const limit = rateLimit(`extract:${clientKey(req)}`, 20, 10 * 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many scans in a short time. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  if (!isClaudeConfigured()) {
    return NextResponse.json(
      { error: "not_configured", message: "AI extraction is not configured on this server." },
      { status: 503 },
    );
  }

  const parsed = ExtractRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request", message: "Send 1-4 label images." }, { status: 400 });
  }
  const { images } = parsed.data;

  try {
    const response = await getClaude().messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 8000,
      system: EXTRACT_SYSTEM,
      output_config: { effort: "low", format: zodOutputFormat(ExtractionSchema) },
      messages: [
        {
          role: "user",
          content: [
            ...images.map((img) => ({
              type: "image" as const,
              source: { type: "base64" as const, media_type: img.media_type, data: img.data },
            })),
            { type: "text" as const, text: EXTRACT_USER(images.length) },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return NextResponse.json(
        { error: "unreadable", message: "Couldn't read an ingredient list from this photo." },
        { status: 422 },
      );
    }

    return NextResponse.json({
      extraction: normaliseExtraction(response.parsed_output),
      source: "claude",
      model: CLAUDE_MODEL,
      prompt_version: EXTRACT_PROMPT_VERSION,
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "busy", message: "The reader is busy. Try again in a moment." }, { status: 503 });
    }
    if (err instanceof Anthropic.APIError) {
      // Log status only: the request body contains the user's photo.
      console.error("extract: Claude API error", err.status, err.requestID);
      return NextResponse.json({ error: "upstream", message: "The label reader failed. Try again." }, { status: 502 });
    }
    console.error("extract: unexpected error", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ error: "internal", message: "Something went wrong reading the label." }, { status: 500 });
  }
}
