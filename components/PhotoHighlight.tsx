"use client";

// A label photo with the boxes of one item outlined, so the user can compare
// what was read with where it was read from.
export function PhotoHighlight({
  url,
  width,
  height,
  boxes,
  label,
}: {
  url: string;
  width: number;
  height: number;
  boxes: number[][]; // [x, y, w, h] in photo pixels
  label: string;
}) {
  return (
    <figure className="relative w-full overflow-hidden rounded-xl border border-border bg-black">
      {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
      <img src={url} alt={label} className="block h-auto w-full" />
      <svg viewBox={`0 0 ${width} ${height}`} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
        {boxes.map(([x, y, w, h], i) => (
          <rect
            key={i}
            x={x - 4}
            y={y - 4}
            width={w + 8}
            height={h + 8}
            rx={6}
            fill="rgba(242,198,109,0.25)"
            stroke="#f2c66d"
            strokeWidth={Math.max(3, width / 250)}
          />
        ))}
      </svg>
    </figure>
  );
}
