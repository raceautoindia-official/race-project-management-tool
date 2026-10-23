/**
 * Which uploaded files may be served inline, for thumbnails and previews.
 *
 * Anything served inline runs on this app's own origin, so the list is a
 * strict allowlist of raster images and nothing else. `image/svg+xml` is
 * deliberately absent: an SVG is a document that can carry script, and one
 * rendered inline here would run with the signed-in person's session. HTML
 * is absent for the same reason. Everything not on this list downloads, as
 * it always did.
 */
const INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
]);

export function isInlineImage(mimeType: string | null | undefined): boolean {
  return INLINE_TYPES.has(String(mimeType ?? "").toLowerCase().trim());
}

/** `inline` when the viewer asked for a preview and the type is safe. */
export function dispositionFor(
  mimeType: string | null | undefined,
  wantsInline: boolean,
  filename: string
): string {
  const safe = filename.replace(/[^\w.\- ]+/g, "_");
  const how = wantsInline && isInlineImage(mimeType) ? "inline" : "attachment";
  return `${how}; filename="${safe}"`;
}
