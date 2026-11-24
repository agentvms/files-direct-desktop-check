/**
 * `files-direct listen` (files-direct-40): the program that keeps running while the Files Direct app does. It holds the connection to every device this computer remembers (the page's own
 * presence code, web/src/pairs.ts), so a phone that remembered this computer can ask to send with no link, QR code or code while no window is open. When one asks, the Files Direct window
 * opens on that meeting and asks the person, naming the phone; nothing is saved before the yes. Closing the window does not stop this. A device saved or forgotten by another run of the
 * program (the window's own, or `devices forget`) is followed within a couple of seconds, because the file of saved devices is looked at again.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { launchWindow, type WindowHandle } from './browser.ts';
import type { Io } from './cli.ts';
import type { ProgramEvent, RoomEnv } from './room.ts';
import type { SavedBook } from './saved.ts';
import { dataDir } from './store.ts';
import { Desk, serveDesk } from './window.ts';

export interface ListenOptions {
  app: boolean;
  noWindow: boolean;
  json: boolean;
  io: Io;
  env: RoomEnv;
  book: SavedBook;
  downloads: string;
  emit: (e: ProgramEvent) => void;
}

/** One `listen` at a time for one person: a second one would only meet "that side already has a connection" for every device. The file holds the number of the one that runs. */
function takeLock(path: string): boolean {
  try {
    const pid = Number(readFileSync(path, 'utf8'));
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        return false; // still running
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EPERM') return false;
      }
    }
  } catch {
    // no lock yet
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, String(process.pid), { mode: 0o600 });
  return true;
}

export async function runListen(o: ListenOptions): Promise<number> {
  const { io, book, env, emit } = o;
  const lock = join(dataDir(io.env), 'listen.pid');
  if (!takeLock(lock)) {
    io.out(o.json ? JSON.stringify({ event: 'listening', already: true, at: new Date().toISOString() }) : 'Files Direct is already waiting for the devices this computer remembers.');
    return 0;
  }
  let busy = false;
  let stopping = false;
  let current: Desk | null = null;
  let leave!: () => void;
  const left = new Promise<void>((r) => (leave = r));

  const meet = async (dev: Parameters<Parameters<SavedBook['watch']>[0]['invite']>[0], nonce: string) => {
    if (busy || stopping) return; // one meeting at a time, as a page leaves an invitation alone when it has a room open
    busy = true;
    emit({ event: 'invite', device: dev.name });
    const desk = (current = new Desk({ env, book, downloads: o.downloads, invited: { dev, nonce } }));
    const server = await serveDesk(desk, { idleMs: io.windowIdleMs });
    let handle: WindowHandle | null = null;
    if (o.noWindow) io.out(o.json ? JSON.stringify({ event: 'window', url: server.url, at: new Date().toISOString() }) : 'Window: ' + server.url);
    else {
      handle = await (io.window ?? launchWindow)(server.url);
      if (!handle) io.err('No browser was found to show the window. Open this address in a browser on this computer: ' + server.url);
      else {
        void handle.closed.then(() => desk.abandon());
        if (o.json) io.out(JSON.stringify({ event: 'window', url: server.url, how: handle.how, ...(handle.pid === undefined ? {} : { pid: handle.pid }), at: new Date().toISOString() }));
      }
    }
    await desk.ended;
    await handle?.close();
    await server.close();
    current = null;
    busy = false;
  };

  const watch = book.watch({
    invite: (dev, nonce) => void meet(dev, nonce),
    forgotten: (dev) => emit({ event: 'forgotten', device: dev.name }),
  });
  emit({ event: 'listening', devices: book.devices().length });
  // started by the app's tray program: it ends when that program does, however it ended (the tray also ends it itself when it quits)
  const parent = process.ppid;
  const watchParent = o.app
    ? setInterval(() => {
        try {
          process.kill(parent, 0);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ESRCH') leave();
        }
      }, 3000)
    : null;
  const stopInterrupt = io.onInterrupt?.(() => {
    stopping = true;
    current?.abandon();
    leave();
  });
  await left;
  if (watchParent) clearInterval(watchParent);
  stopInterrupt?.();
  watch.stop();
  try {
    if (Number(readFileSync(lock, 'utf8')) === process.pid) rmSync(lock, { force: true });
  } catch {
    // already gone
  }
  return 0;
}
