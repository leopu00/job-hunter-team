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
  const imageItems = Array.from(clipboard.items).filter(
    (candidate) =>
      candidate.kind === "file" && candidate.type.startsWith("image/"),
  );
  if (imageItems.length === 0) return { kind: "none" };
  if (imageItems.length !== 1) return { kind: "rejected", reason: "type" };
  const item = imageItems[0];
  if (item.type !== "image/png" && item.type !== "image/jpeg") {
    return { kind: "rejected", reason: "type" };
  }
  const blob = item.getAsFile();
  if (!blob) return { kind: "rejected", reason: "type" };
  if (blob.type !== item.type) return { kind: "rejected", reason: "type" };
  if (blob.size > MAX_CLIPBOARD_IMAGE_BYTES) {
    return { kind: "rejected", reason: "size" };
  }
  const extension = blob.type === "image/png" ? "png" : "jpg";
  return {
    kind: "image",
    file: new File(
      [blob],
      `clipboard-screenshot-${crypto.randomUUID()}.${extension}`,
      {
        type: blob.type,
        lastModified: 0,
      },
    ),
  };
}
