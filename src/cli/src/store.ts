/**
 * Where the program keeps the devices it remembers (files-direct-40, docs/PROTOCOL.md "Saved devices"). One versioned JSON file in the person's own data folder, the same shape and the same
 * limit (ten devices) as the browser's `fd-devices`, read and written by the page's own code (web/src/devices.ts) through this file-shaped `Keeper`. It is data, not settings: there is no
 * other file and no option. Only this person can read it (mode 0600 in a folder of mode 0700), because it holds the secrets of the pairs. Nothing in it ever goes to our servers but what
 * the pair routes take (the pair id, the check of the forget token, the forget token), and a name never does.
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Keeper } from '../../web/src/devices.ts';

/** The data folder: FILES_DIRECT_DATA when set (a test, or a person who wants it elsewhere), else the system's own place for a program's data (the Mac app's folder is the one `app remove` already clears). */
export function dataDir(env: Record<string, string | undefined>, platform: string = process.platform): string {
  if (env.FILES_DIRECT_DATA) return env.FILES_DIRECT_DATA;
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Files Direct');
  if (platform === 'win32') return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Files Direct');
  return join(env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'files-direct');
}

/** The files the program itself writes in the data folder (devices.json here, listen.pid in cli/src/listen.ts). */
export const APP_DATA_FILES = ['devices.json', 'listen.pid'] as const;

/**
 * What `app remove` takes out of the data folder. The system's own place is the app's alone (its name is in the path), so all of it goes. A folder the person named with FILES_DIRECT_DATA
 * may be one they use for other things: only the app's own files go, and `folder` says to remove the folder itself too, but only when nothing else is left in it.
 */
export function dataLeftovers(env: Record<string, string | undefined>): { paths: string[]; folder?: string } {
  const dir = dataDir(env);
  if (!env.FILES_DIRECT_DATA) return { paths: [dir] };
  return { paths: APP_DATA_FILES.map((f) => join(dir, f)), folder: dir };
}

export const devicesFile = (env: Record<string, string | undefined>, platform?: string): string => join(dataDir(env, platform), 'devices.json');

/** A `Keeper` over one file. A file that is missing or cannot be read is "nothing kept"; a write goes to a new file and is moved into place, so a reader never sees half of it. */
export function fileKeeper(path: string): Keeper {
  return {
    getItem(): string | null {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    setItem(_key: string, value: string): void {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const tmp = path + '.' + process.pid + '.tmp';
      writeFileSync(tmp, value, { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, path);
    },
  };
}
