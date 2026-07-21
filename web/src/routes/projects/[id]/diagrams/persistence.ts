// Schema + validation for the diagram data persisted to localStorage
// (web/src/routes/diagrams/+page.svelte's `checked`/`savedLayout`).
// Deliberately has zero Svelte/DOM dependency, so it can be unit tested
// directly (see persistence.test.ts) without mounting a component.
import { z } from "zod";

// Where a node's label is positioned within its box. Structurally
// identical to (and interchangeable with) geometry.ts's `TextAlign` type,
// which stays the canonical type for anything unrelated to persistence
// (e.g. textPosition()'s geometry math) — this schema only needs to agree
// with it on shape, not share a literal import, since both are plain
// string-literal unions.
const TextAlignSchema = z.enum(["center", "top-center", "top-left"]);

// Position + size + style of a node, as stored in checked/savedLayout.
// width/height/textAlign are optional so entries persisted before those
// features existed still parse; see +page.svelte's nodeBox() for the
// backfilled read path.
export const StoredBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  textAlign: TextAlignSchema.optional(),
});

export type StoredBox = z.infer<typeof StoredBoxSchema>;

// Validates a raw, untrusted record (e.g. straight from
// JSON.parse(localStorage.getItem(...))) against StoredBoxSchema,
// dropping any entry that doesn't match instead of letting a
// corrupted/hand-edited/malformed entry propagate NaN/undefined into the
// geometry math downstream. Each entry is parsed independently (rather
// than parsing the whole record as one z.record(...) schema), so one bad
// entry doesn't invalidate the rest of an otherwise-valid record.
export function sanitizeStoredRecord(
  record: Record<string, unknown>,
): Record<string, StoredBox> {
  const sanitized: Record<string, StoredBox> = {};
  let droppedKeys: string[] | null = null;

  for (const [key, value] of Object.entries(record)) {
    const result = StoredBoxSchema.safeParse(value);
    if (result.success) {
      sanitized[key] = result.data;
    } else {
      (droppedKeys ??= []).push(key);
    }
  }

  if (droppedKeys) {
    console.warn(
      `Dropped ${droppedKeys.length} malformed diagram layout entr${
        droppedKeys.length === 1 ? "y" : "ies"
      }: ${droppedKeys.join(", ")}`,
    );
  }

  return sanitized;
}
