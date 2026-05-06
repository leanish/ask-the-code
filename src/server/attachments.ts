import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { FileAskAttachment } from "../core/types.ts";

const ATTACHMENT_ROOT = path.join(tmpdir(), "atc-attachments");
const MAX_MULTIPART_ATTACHMENTS = 8;
const MAX_MULTIPART_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export type IncomingAttachment = {
  name: string;
  mediaType: string;
  bytes: Uint8Array;
};

export type SavedAttachments = {
  refs: FileAskAttachment[];
  cleanup: () => Promise<void>;
};

export async function saveAttachments(incoming: IncomingAttachment[]): Promise<SavedAttachments> {
  if (incoming.length === 0) {
    return {
      refs: [],
      cleanup: async () => {}
    };
  }

  if (incoming.length > MAX_MULTIPART_ATTACHMENTS) {
    throw createAttachmentError(400, `Attach at most ${MAX_MULTIPART_ATTACHMENTS} files.`);
  }

  for (const attachment of incoming) {
    if (attachment.bytes.byteLength > MAX_MULTIPART_ATTACHMENT_BYTES) {
      throw createAttachmentError(
        413,
        `${attachment.name} exceeds the ${MAX_MULTIPART_ATTACHMENT_BYTES} byte attachment limit.`
      );
    }
  }

  const directory = path.join(ATTACHMENT_ROOT, randomUUID());
  await mkdir(directory, { recursive: true });

  const refs: FileAskAttachment[] = [];
  for (const [index, attachment] of incoming.entries()) {
    const filePath = path.join(directory, `${index + 1}-${sanitizeAttachmentName(attachment.name)}`);
    await writeFile(filePath, attachment.bytes);
    refs.push({
      name: attachment.name,
      mediaType: attachment.mediaType || "application/octet-stream",
      path: filePath,
      size: attachment.bytes.byteLength
    });
  }

  return {
    refs,
    cleanup: async () => {
      await rm(directory, { force: true, recursive: true });
    }
  };
}

function sanitizeAttachmentName(name: string): string {
  const sanitized = name.replace(/[\\/]/gu, "_").replace(/^\.+/u, "_").trim();
  return sanitized === "" ? "attachment" : sanitized;
}

function createAttachmentError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}
