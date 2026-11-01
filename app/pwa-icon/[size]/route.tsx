import { ImageResponse } from "next/og";

const SIZES = [180, 192, 512] as const;

export const dynamic = "force-static";
export function generateStaticParams() {
  return SIZES.map((s) => ({ size: String(s) }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const n = Number((await params).size);
  const size = SIZES.includes(n as (typeof SIZES)[number]) ? n : 512;
  // Lens ring over three label lines, kept inside the maskable safe zone.
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f6b5c" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: size * 0.05, width: size * 0.46 }}>
          {[1, 0.8, 0.6].map((w) => (
            <div key={w} style={{ height: size * 0.06, width: `${w * 100}%`, background: "#f7f6f2", borderRadius: size * 0.03 }} />
          ))}
        </div>
        <div
          style={{
            position: "absolute",
            width: size * 0.5,
            height: size * 0.5,
            border: `${size * 0.045}px solid #f2c66d`,
            borderRadius: "50%",
            left: size * 0.32,
            top: size * 0.2,
          }}
        />
      </div>
    ),
    { width: size, height: size },
  );
}
