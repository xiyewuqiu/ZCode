import { lstat, readdir, realpath, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export interface PurgeFile {
  path: string;
  size: number;
  modified: number;
  inode: number;
}
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]{1,200}$/;
export function ownedSessionRoots(storageRoot: string, sessionId: string): string[] {
  if (!SAFE_SESSION_ID.test(sessionId)) throw new Error("unsafe_session_id");
  return ["sessions", "agents"].map((kind) => join(resolve(storageRoot), "cli", kind, sessionId));
}
function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}
export async function validateOwnedPath(root: string, path: string): Promise<boolean> {
  const base = resolve(root),
    target = resolve(path),
    suffix = relative(base, target);
  if (suffix === "" || suffix.startsWith(`..${sep}`) || suffix === ".." || isAbsolute(suffix))
    throw new Error("unsafe_file_path");
  let cursor = base;
  for (const piece of ["", ...suffix.split(sep)]) {
    if (piece) cursor = join(cursor, piece);
    try {
      if ((await lstat(cursor)).isSymbolicLink()) throw new Error("unsafe_file_link");
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }
  const canonicalRoot = await realpath(base),
    canonical = await realpath(target);
  const back = relative(canonicalRoot, canonical);
  if (back.startsWith(`..${sep}`) || isAbsolute(back)) throw new Error("unsafe_file_path");
  return true;
}
export async function scanOwnedFiles(root: string, sessionId: string): Promise<PurgeFile[]> {
  const files: PurgeFile[] = [];
  const visit = async (path: string): Promise<void> => {
    if (!(await validateOwnedPath(root, path))) return;
    const info = await lstat(path);
    if (info.isDirectory()) {
      for (const entry of await readdir(path)) await visit(join(path, entry));
    } else if (info.isFile() && info.nlink === 1)
      files.push({
        path: relative(root, path),
        size: info.size,
        modified: info.mtimeMs,
        inode: info.ino,
      });
    else throw new Error("unsafe_file_type");
  };
  for (const path of ownedSessionRoots(root, sessionId)) await visit(path);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export async function removeOwnedFile(
  root: string,
  sessionId: string,
  file: PurgeFile,
): Promise<boolean> {
  const path = resolve(root, file.path);
  if (
    !ownedSessionRoots(root, sessionId).some((dir) => {
      const back = relative(dir, path);
      return back !== "" && !back.startsWith(`..${sep}`) && back !== ".." && !isAbsolute(back);
    })
  )
    throw new Error("unsafe_file_path");
  if (!(await validateOwnedPath(root, path))) return false;
  const info = await lstat(path);
  // 清单之后有新写入时保留文件；旧清理任务不能误删新内容。
  if (
    !info.isFile() ||
    info.nlink !== 1 ||
    info.size !== file.size ||
    info.mtimeMs !== file.modified ||
    info.ino !== file.inode
  )
    throw new Error("file_changed_after_preview");
  await unlink(path);
  return true;
}
