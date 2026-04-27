import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type { AttachmentRef } from "../core/types.ts";

const ROOT_DIR = join(tmpdir(), "atc-attachments");
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export interface SavedAttachments {
  refs: AttachmentRef[];
  cleanup: () => Promise<void>;
}

export interface IncomingAttachment {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export async function saveAttachments(
  incoming: IncomingAttachment[]
): Promise<SavedAttachments> {
  if (incoming.length === 0) {
    return { refs: [], cleanup: async () => {} };
  }
  if (incoming.length > MAX_ATTACHMENTS) {
    throw Object.assign(new Error(`Too many attachments (limit ${MAX_ATTACHMENTS}).`), {
      statusCode: 400
    });
  }

  for (const file of incoming) {
    if (file.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw Object.assign(
        new Error(`Attachment ${file.name} exceeds ${MAX_ATTACHMENT_BYTES} bytes.`),
        { statusCode: 413 }
      );
    }
  }

  const dir = join(ROOT_DIR, randomUUID());
  await mkdir(dir, { recursive: true });

  const refs: AttachmentRef[] = [];
  for (const file of incoming) {
    const safeName = sanitizeAttachmentName(file.name);
    const filePath = join(dir, safeName);
    await writeFile(filePath, file.bytes);
    refs.push({
      name: file.name,
      path: filePath,
      type: file.type,
      size: file.bytes.byteLength
    });
  }

  return {
    refs,
    cleanup: async () => {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  };
}

function sanitizeAttachmentName(name: string): string {
  const trimmed = name.replace(/[\\/]/g, "_").trim();
  if (!trimmed) return "attachment";
  // Strip leading dots so we don't write hidden files.
  return trimmed.replace(/^\.+/u, "_");
}
