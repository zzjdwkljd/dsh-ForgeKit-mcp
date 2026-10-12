import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const DATA_ROOT = path.resolve(PROJECT_ROOT, 'test');

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function validateComponent(component: string): void {
  if (!component || component === '.' || component === '..' || /[<>:"|?*\x00-\x1f/\\]/.test(component) || /[. ]$/.test(component) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(component)) {
    throw new Error(`Invalid data path component: ${component}`);
  }
}

/** Stable project-relative location, independent of process.cwd(). */
export function dataPath(...parts: string[]): string {
  for (const part of parts) validateComponent(part);
  return path.join(DATA_ROOT, ...parts);
}

/** Relative inputs are scoped; explicit test/... paths are project-relative. */
export function resolveDataPath(input: string, scope = DATA_ROOT): string {
  if (!input || input.includes('\0')) throw new Error('A non-empty data path is required');
  const root = path.resolve(scope);
  if (!inside(DATA_ROOT, root)) throw new Error('Data scope must remain inside test/');
  const portable = input.replace(/[\\/]/g, path.sep);
  if (process.platform !== 'win32' && path.win32.isAbsolute(input)) {
    throw new Error('Foreign absolute data paths are not supported');
  }
  const target = path.resolve(path.isAbsolute(portable) ? portable : /^test(?:[\\/]|$)/i.test(input) ? path.join(PROJECT_ROOT, portable) : path.join(root, portable));
  if (!inside(root, target) || !inside(DATA_ROOT, target)) {
    throw new Error(`Data path must remain inside ${path.relative(PROJECT_ROOT, root) || 'test/'}; outside paths are rejected`);
  }
  for (const part of path.relative(DATA_ROOT, target).split(path.sep).filter(Boolean)) validateComponent(part);
  return target;
}

/** Reject existing symlinks/junctions and multiply-linked files, including test/ itself. */
export async function checkedDataPath(input: string, scope = DATA_ROOT): Promise<string> {
  const target = resolveDataPath(input, scope);
  let cursor = PROJECT_ROOT;
  for (const component of path.relative(PROJECT_ROOT, target).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    try {
      const entry = await fs.lstat(cursor);
      if (entry.isSymbolicLink()) throw new Error('Data paths cannot traverse symbolic links or junctions');
      if (entry.isFile() && entry.nlink > 1) throw new Error('Data paths cannot use hard-linked files');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
  }
  return target;
}

export async function ensureDataDir(input: string, scope = DATA_ROOT): Promise<string> {
  const target = await checkedDataPath(input, scope);
  await fs.mkdir(target, { recursive: true });
  return checkedDataPath(target, scope);
}

export async function createDataRun(category: string, owner: string): Promise<string> {
  const parent = await ensureDataDir(dataPath(category, owner));
  return checkedDataPath(await fs.mkdtemp(path.join(parent, 'run-')));
}

export async function readDataFile(input: string, scope = DATA_ROOT): Promise<string> {
  return fs.readFile(await checkedDataPath(input, scope), 'utf8');
}

/** Atomic replacement, or exclusive creation for artifacts that must never overwrite. */
export async function writeDataFile(input: string, value: string | Uint8Array, exclusive = false): Promise<void> {
  const target = await checkedDataPath(input);
  await ensureDataDir(path.dirname(target));
  if (exclusive) {
    const handle = await fs.open(await checkedDataPath(target), 'wx', 0o600);
    try {
      await handle.writeFile(value);
    } catch (error) {
      await handle.close();
      await fs.rm(target, { force: true });
      throw error;
    } finally {
      await handle.close();
    }
    return;
  }
  const temporary = path.join(path.dirname(target), `.forgekit-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, value, { flag: 'wx', mode: 0o600 });
    await checkedDataPath(target);
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
