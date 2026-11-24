/**
 * The command line's side of saved devices (files-direct-40): `devices` (list, forget) and `receive --saved` (wait for a saved device to ask to send, take one batch, end). The rules of
 * remembering and of meeting are the page's own code (web/src/remember.ts, web/src/pairs.ts); this file only chooses what the command line says and does.
 */
import { cleanDeviceName } from '../../shared/pair.ts';
import { SAVED } from '../../web/src/saved-copy.ts';
import { PairHost, guessComputerName } from './pair-host.ts';
import { type ProgramEvent, type Result, type RoomEnv, receive } from './room.ts';
import { SavedBook, meetingSecret } from './saved.ts';
import { reasonText } from './words.ts';

export interface Say {
  out(text: string): void;
  err(text: string): void;
}

const stamp = () => new Date().toISOString();

/** `files-direct devices` and `files-direct devices forget <number or name>`. */
export async function runDevices(words: string[], book: SavedBook, io: Say, json: boolean): Promise<number> {
  const [what, ...rest] = words;
  const line = (e: Record<string, unknown>, text: string) => io.out(json ? JSON.stringify({ event: 'devices', ...e, at: stamp() }) : text);
  const fail = (reason: string, text: string) => {
    if (json) io.out(JSON.stringify({ event: 'failed', reason, message: text, at: stamp() }));
    else io.err(text);
    return 2;
  };
  if (what === undefined) {
    const all = book.devices();
    const names = all.map((d) => d.name);
    line(
      { devices: names.map((name) => ({ name })) },
      all.length === 0 ? 'No saved devices. Remember one with: files-direct receive <link> --remember' : 'Saved devices:\n' + names.map((n, i) => '  ' + (i + 1) + '  ' + n).join('\n'),
    );
    return 0;
  }
  if (what !== 'forget' || rest.length !== 1) return fail('usage', 'Say what to do: devices, or devices forget <number or name>. Run files-direct help.');
  const dev = book.find(rest[0]!);
  if (!dev) return fail('usage', 'No single saved device is called that. Run files-direct devices to see the list, and use its number.');
  const ended = (await book.forget(dev)) === 'ok';
  io.out(json ? JSON.stringify({ event: 'forgotten', device: dev.name, ended, at: stamp() }) : ended ? SAVED.forgotten(dev.name) : SAVED.forgotUnsure(dev.name));
  return 0;
}

export interface ReceiveSavedOptions {
  dest: string;
  maxSize?: number;
  overwrite?: boolean;
  /** Minutes to wait for a saved device. 0 waits for ever. */
  minutes: number;
  /** Start from here when a device asks (tests); by default the room is joined and a batch taken. */
  emit: (e: ProgramEvent) => void;
}

export interface Waiting {
  done: Promise<Result>;
  cancel(): void;
}

/** Waits for a saved device to ask to send, takes the one batch it offers by the rules of `receive`, and ends. Saved devices that forgot this computer are dropped as they are found out. */
export function receiveSaved(env: RoomEnv, book: SavedBook, o: ReceiveSavedOptions): Waiting {
  let finish!: (r: Result) => void;
  const done = new Promise<Result>((r) => (finish = r));
  let ended = false;
  let run: ReturnType<typeof receive> | null = null;
  let starting = false;
  const stop = { watch: null as ReturnType<SavedBook['watch']> | null, timer: null as ReturnType<typeof setTimeout> | null };
  const end = (r: Result) => {
    if (ended) return;
    ended = true;
    if (stop.timer) clearTimeout(stop.timer);
    stop.watch?.stop();
    finish(r);
  };
  const plain = (outcome: 'nobody_came' | 'no_saved_devices' | 'cancelled'): Result => {
    const message = reasonText(outcome);
    o.emit({ event: 'failed', reason: outcome, message });
    return { outcome, message, files: 0, bytes: 0, route: null, saved: [] };
  };
  const invite = async (dev: ReturnType<SavedBook['devices']>[number], nonce: string) => {
    if (run || starting || ended) return; // one batch, one device; another that asks meanwhile is left waiting on its own end
    starting = true;
    if (stop.timer) clearTimeout(stop.timer);
    o.emit({ event: 'invite', device: dev.name });
    const pair = new PairHost({ kv: book.kv, where: book.where, guess: guessComputerName, saved: dev });
    run = receive(env, { target: { kind: 'link', secret: await meetingSecret(dev, nonce) }, dest: o.dest, maxSize: o.maxSize, overwrite: o.overwrite, pair }, o.emit);
    void run.done.then(end);
  };
  stop.watch = book.watch({
    invite: (dev, nonce) => void invite(dev, nonce),
    forgotten: (dev) => {
      o.emit({ event: 'forgotten', device: cleanDeviceName(dev.name) });
      if (!run && book.devices().length === 0) end(plain('no_saved_devices'));
    },
  });
  o.emit({ event: 'listening', devices: book.devices().length });
  if (o.minutes > 0) stop.timer = setTimeout(() => !run && !starting && end(plain('nobody_came')), o.minutes * 60_000);
  return {
    done,
    cancel: () => (run ? run.cancel() : end(plain('cancelled'))),
  };
}
