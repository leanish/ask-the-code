import fs from "node:fs/promises";

type FsAccessModule = Pick<typeof fs, "access">;

export async function pathExists(targetPath: string, fsModule: FsAccessModule = fs): Promise<boolean> {
  try {
    await fsModule.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
