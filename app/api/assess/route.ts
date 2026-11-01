import { NextResponse } from "next/server";
import { AssessSchema } from "@/lib/read/types";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { callVisionService, checkPhotos, visionServiceUrl } from "@/lib/vision-service";

export const runtime = "nodejs";
export const maxDuration = 20;

// Quality check for one freshly captured photo, so the user can retake it
// before the label is read.
export async function POST(req: Request) {
  const limit = rateLimit(`assess:${clientKey(req)}`, 60, 10 * 60_000);
  if (!limit.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  if (!visionServiceUrl()) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File) || checkPhotos([file])) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const out = new FormData();
  out.append("image", file, "photo.jpg");
  try {
    const res = await callVisionService("/assess", out, 15_000);
    const parsed = AssessSchema.safeParse(await res!.json().catch(() => null));
    if (!res!.ok || !parsed.success) return NextResponse.json({ error: "upstream" }, { status: 502 });
    return NextResponse.json(parsed.data);
  } catch {
    return NextResponse.json({ error: "unreachable" }, { status: 503 });
  }
}
