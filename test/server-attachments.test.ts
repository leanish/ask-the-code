import { access, readFile } from "node:fs/promises";
import { basename } from "node:path";

import { describe, expect, it } from "vitest";

import { saveAttachments, type IncomingAttachment } from "../src/server/attachments.ts";

describe("saveAttachments", () => {
  it("returns an empty result for requests without files", async () => {
    const saved = await saveAttachments([]);

    expect(saved.refs).toEqual([]);
    await expect(saved.cleanup()).resolves.toBeUndefined();
  });

  it("writes attachments with sanitized filenames and cleans them up", async () => {
    const saved = await saveAttachments([
      {
        name: "../.notes.md",
        type: "text/markdown",
        bytes: new TextEncoder().encode("hello")
      }
    ]);

    expect(saved.refs).toHaveLength(1);
    expect(saved.refs[0]).toMatchObject({
      name: "../.notes.md",
      type: "text/markdown",
      size: 5
    });
    expect(basename(saved.refs[0]!.path)).toBe("__.notes.md");
    await expect(readFile(saved.refs[0]!.path, "utf8")).resolves.toBe("hello");

    await saved.cleanup();
    await expect(access(saved.refs[0]!.path)).rejects.toThrow();
  });

  it("rejects requests with too many attachments", async () => {
    const incoming = Array.from({ length: 11 }, (_, index): IncomingAttachment => ({
      name: `file-${index}.txt`,
      type: "text/plain",
      bytes: new Uint8Array()
    }));

    await expect(saveAttachments(incoming)).rejects.toMatchObject({
      message: "Too many attachments (limit 10).",
      statusCode: 400
    });
  });

  it("rejects attachments above the size limit before writing them", async () => {
    const oversized = {
      name: "large.bin",
      type: "application/octet-stream",
      bytes: { byteLength: 100 * 1024 * 1024 + 1 } as Uint8Array
    };

    await expect(saveAttachments([oversized])).rejects.toMatchObject({
      message: "Attachment large.bin exceeds 104857600 bytes.",
      statusCode: 413
    });
  });
});
