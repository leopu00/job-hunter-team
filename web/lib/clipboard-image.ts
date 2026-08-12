const MAX_CLIPBOARD_IMAGE_BYTES = 10 * 1024 * 1024;

export type ClipboardImageResult =
  | { kind: "image"; file: File }
  | { kind: "none" }
  | { kind: "rejected"; reason: "size" | "type" };

/** Extract only image MIME types accepted by the existing upload transport. */
export function clipboardImageFile(
  clipboard: Pick<ClipboardEvent, "clipboardData">["clipboardData"],
): ClipboardImageResult {
  if (!clipboard) return { kind: "none" };
  const item = Array.from(clipboard.items).find(
    (candidate) =>
      candidate.kind === "file" &&
      (candidate.type === "image/png" || candidate.type === "image/jpeg"),
  );
  if (!item) return { kind: "none" };
  const blob = item.getAsFile();
  if (!blob) return { kind: "rejected", reason: "type" };
  if (blob.size > MAX_CLIPBOARD_IMAGE_BYTES) {
    return { kind: "rejected", reason: "size" };
  }
  const extension = blob.type === "image/png" ? "png" : "jpg";
  return {
    kind: "image",
    file: new File([blob], `clipboard-screenshot.${extension}`, {
      type: blob.type,
      lastModified: 0,
    }),
  };
}
