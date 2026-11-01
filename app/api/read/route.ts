import { NextResponse } from "next/server";
import { ReadResultSchema } from "@/lib/read/types";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { callVisionService, checkPhotos, visionServiceUrl } from "@/lib/vision-service";

export const runtime = "nodejs";
export const maxDuration = 60;

// Forwards label photos to the vision service. Photos are streamed through
// in memory; nothing is stored or logged here.
export async function POST(req: Request) {
  const limit = rateLimit(`read:${clientKey(req)}`, 20, 10 * 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many scans in a short time. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }
  if (!visionServiceUrl()) {
    return NextResponse.json({ error: "not_configured", message: "The label reader is not configured." }, { status: 503 });
  }

  const form = await req.formData().catch(() => null);
  const files = (form?.getAll("images") ?? []).filter((f): f is File => f instanceof File);
  const problem = checkPhotos(files);
  if (problem) return NextResponse.json({ error: "bad_request", message: problem }, { status: 400 });

  const out = new FormData();
  files.forEach((f, i) => out.append("images", f, `photo-${i + 1}.jpg`));
  out.append("use_claude", "true");

  try {
    const res = await callVisionService("/read", out, 55_000);
    const body = await res!.json().catch(() => null);
    if (!res!.ok) {
      const message = typeof body?.detail === "string" ? body.detail : "The label reader failed. Try again.";
      return NextResponse.json({ error: "upstream", message }, { status: res!.status === 422 ? 422 : 502 });
    }
    const parsed = ReadResultSchema.safeParse(body);
    if (!parsed.success) {
      console.error("read: vision service returned an unexpected shape");
      return NextResponse.json({ error: "upstream", message: "The label reader returned something unexpected." }, { status: 502 });
    }
    return NextResponse.json(parsed.data);
  } catch (err) {
    console.error("read: vision service unreachable", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ error: "unreachable", message: "Couldn't reach the label reader." }, { status: 503 });
  }
}
