/**
 * The devices this computer remembers, and finding them while the program runs (files-direct-40). `SavedBook` reads and writes the program's file of saved devices with the page's own
 * code; `watch` keeps one presence socket per saved device (the page's own code too, web/src/pairs.ts) and hears when a saved device here asks to send. Forgetting a device removes it
 * from this computer's file first and then tells our server, which ends the pair for both and tells the other device if it is connected (docs/PROTOCOL.md "Saved devices").
 */
import { forgetTokenFromSecret, roomSecretFromPair } from '../../shared/pair.ts';
import { type SavedDevice, readStore, removeDevice } from '../../web/src/devices.ts';
import { forgetPair, openPresence } from '../../web/src/pairs.ts';
import type { SignalWhere } from '../../web/src/signal.ts';
import { fileKeeper } from './store.ts';

export interface WatchHandlers {
  /** A saved device that is here asks to send: its nonce (the room's secret is made from it and the pair secret). */
  invite(dev: SavedDevice, nonce: string): void;
  /** The pair is gone on the other side (it forgot this computer, or the pair ran out): it is dropped from the file. */
  forgotten(dev: SavedDevice): void;
}

export interface Watch {
  stop(): void;
}

/** How often the file is looked at again while watching, so a device saved or forgotten by another run of the program (a window) is followed. */
export const WATCH_POLL_MS = 2000;

export class SavedBook {
  readonly kv: ReturnType<typeof fileKeeper>;

  constructor(file: string, readonly where: SignalWhere) {
    this.kv = fileKeeper(file);
  }

  devices(): SavedDevice[] {
    return readStore(this.kv).devices;
  }

  /** A device by its number in the list (from 1) or by its name, ignoring capitals. Null when nothing or more than one matches. */
  find(ref: string): SavedDevice | null {
    const all = this.devices();
    if (/^\d+$/.test(ref)) return all[Number(ref) - 1] ?? null;
    const same = all.filter((d) => d.name.toLowerCase() === ref.toLowerCase());
    return same.length === 1 ? same[0]! : null;
  }

  /** Takes the device out of this computer's file at once, then ends the pair on our side. 'failed' when our server could not be reached (the other device may still list this one until the pair ends by itself). */
  async forget(dev: SavedDevice): Promise<'ok' | 'failed'> {
    removeDevice(this.kv, dev.id);
    return forgetPair(dev.id, await forgetTokenFromSecret(dev.secret), this.where);
  }

  watch(h: WatchHandlers): Watch {
    const presence = openPresence(
      {
        devices: () => this.devices(),
        changed: () => {},
        invite: (dev, nonce) => h.invite(dev, nonce),
        forgotten: (dev) => {
          removeDevice(this.kv, dev.id);
          h.forgotten(dev);
        },
      },
      this.where,
    );
    presence.sync();
    const timer = setInterval(() => presence.sync(), WATCH_POLL_MS);
    return {
      stop: () => {
        clearInterval(timer);
        presence.close();
      },
    };
  }
}

/** The secret of the room one meeting uses, made the same way on both sides. */
export const meetingSecret = (dev: SavedDevice, nonce: string): Promise<string> => roomSecretFromPair(dev.secret, nonce);
