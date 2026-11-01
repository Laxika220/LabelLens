import * as z from "zod";

// Shape of the vision service's /read response. Validated on the server
// before it reaches the browser.

export const STATUSES = ["confirmed", "probable", "conflicting", "unreadable", "missing"] as const;
export type Status = (typeof STATUSES)[number];

const Box = z.array(z.number()).length(4); // [x, y, w, h] on the photo

export const WordSchema = z.object({
  text: z.string(),
  status: z.enum(STATUSES),
  photo: z.number().int(),
  box: Box,
  score: z.number().nullable(),
  support: z.array(z.string()),
  alternatives: z.record(z.string(), z.array(z.string())),
  illegible_to: z.array(z.string()),
  plausible: z.boolean(),
  suggestions: z.array(z.string()),
});
export type Word = z.infer<typeof WordSchema>;

export const ItemSchema = z.object({
  kind: z.enum(["ingredient", "statement", "missing", "unreadable_region"]),
  raw: z.string(),
  status: z.enum(STATUSES),
  words: z.array(WordSchema),
  photo: z.number().int().nullable(),
  boxes: z.array(Box),
  sources: z.array(z.string()),
  engines_agree: z.boolean().nullable(),
  needs_review: z.boolean(),
  note: z.string(),
});
export type Item = z.infer<typeof ItemSchema>;

export const PhotoReportSchema = z.object({
  index: z.number().int(),
  width: z.number(),
  height: z.number(),
  verdict: z.enum(["good", "usable", "retake"]),
  advice: z.array(z.string()),
  usable_fraction: z.number(),
  regions: z.array(z.object({ box: z.array(z.array(z.number())), issues: z.array(z.string()) })),
  glare_blobs: z.array(Box),
  cut_off_edges: z.array(z.string()),
  claude_used: z.boolean(),
});
export type PhotoReport = z.infer<typeof PhotoReportSchema>;

export const ReadResultSchema = z.object({
  pipeline: z.object({
    ocr: z.string(),
    variants: z.array(z.string()),
    claude: z.string().nullable(),
    claude_prompt: z.string().nullable(),
    calibration: z.string(),
  }),
  photos: z.array(PhotoReportSchema),
  items: z.array(ItemSchema),
  allergen_section_uncertain: z.boolean(),
  warnings: z.array(z.string()),
  text: z.string(),
});
export type ReadResult = z.infer<typeof ReadResultSchema>;

// /assess response (quality only), as much as the scan screen uses.
export const AssessSchema = z.object({
  verdict: z.enum(["good", "usable", "retake"]),
  advice: z.array(z.string()),
  usable_fraction: z.number(),
  text_lines: z.number(),
});
export type Assessment = z.infer<typeof AssessSchema>;

// Where a reading came from, as shown to the user.
export type ReadSource = "pipeline" | "claude-only" | "on-device" | "manual";
