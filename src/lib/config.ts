import path from "node:path";
import fs from "node:fs";

export function dataDir(): string {
  const dir = path.resolve(process.env.DATA_DIR || "./data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
export function projectDir(id: string): string {
  const dir = path.join(dataDir(), "projects", id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
export function cacheDir(): string {
  const dir = path.join(dataDir(), "cache");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
export const MAX_AUTO_REVISIONS = 2;
