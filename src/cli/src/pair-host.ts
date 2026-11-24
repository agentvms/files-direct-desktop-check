/**
 * Remembering and keeping names current, for a run of the program (files-direct-40). It is the page's own code (web/src/remember.ts, web/src/saved-name.ts) with the program's file of
 * saved devices under it and a view that is not a page: the command line answers by itself (its flags are the yes), the window asks a person. The frames, the order and the limits are
 * the ones in docs/PROTOCOL.md "Saved devices"; nothing here is a second copy of them.
 */
import { hostname } from 'node:os';
import { cleanDeviceName } from '../../shared/pair.ts';
import { type Keeper, type SavedDevice, readStore } from '../../web/src/devices.ts';
import { forgetPair, registerPair } from '../../web/src/pairs.ts';
import { RememberFlow, type RememberProblem, type RememberView } from '../../web/src/remember.ts';
import { savedName } from '../../web/src/saved-name.ts';
import type { SignalWhere } from '../../web/src/signal.ts';
import type { PairWire } from '../../web/src/transfer/frames.ts';
import type { PairPort } from './room.ts';

export interface PairHostOptions {
  kv: Keeper;
  where: SignalWhere;
  /** What a person sees or what answers for them. Not used in a room with a saved device (nothing is offered there). */
  view?: RememberView;
  /** The name to offer when this computer has not been given one. */
  guess: () => string;
  /** The saved device this room is with: names are kept current, and "Remember this device" is not offered. */
  saved?: SavedDevice;
  /** A device was kept. */
  onSaved?: (d: SavedDevice) => void;
  /** The saved device's stored name changed (it was renamed there). */
  onRenamed?: (name: string) => void;
}

/** The computer's own name as a first guess for what to call it, cut and cleaned like any device name. */
export const guessComputerName = (host: string = hostname()): string => cleanDeviceName(host.replace(/\.local$/i, '')) || 'This computer';

export class PairHost implements PairPort {
  readonly says = true;
  private flow: RememberFlow | null = null;
  private names: ReturnType<typeof savedName> | null = null;
  private send: ((m: PairWire) => void) | null = null;
  private canPair = false;
  private up = false;

  constructor(private readonly o: PairHostOptions) {
    if (o.saved) {
      this.names = savedName({ kv: o.kv, id: o.saved.id, send: (m) => this.send?.(m), changed: (name) => o.onRenamed?.(name) });
    } else if (o.view) {
      this.flow = new RememberFlow({
        kv: o.kv,
        view: o.view,
        send: (m) => this.send?.(m),
        guess: o.guess,
        register: (id, check) => registerPair(id, check, o.where),
        unregister: async (id, token) => void (await forgetPair(id, token, o.where)),
        after: (fn, ms) => {
          const t = setTimeout(fn, ms);
          return () => clearTimeout(t);
        },
        saved: (d) => o.onSaved?.(d),
      });
    }
  }

  attach(send: (m: PairWire) => void): void {
    this.send = send;
  }

  other(canPair: boolean): void {
    this.canPair = canPair;
    this.update();
  }

  connected(on: boolean): void {
    this.up = on;
    if (!on) {
      this.flow?.dispose();
      this.flow = null;
      return;
    }
    this.update();
    if (this.canPair) this.names?.hello();
  }

  private update(): void {
    this.flow?.setAvailable(this.up && this.canPair);
  }

  handle(m: PairWire): void {
    void this.flow?.handle(m);
    this.names?.handle(m);
  }

  /** Resolves when no try at remembering is under way (at once when none is). */
  settled(): Promise<void> {
    return new Promise((resolve) => {
      const look = () => (this.flow?.busy ? false : (resolve(), true));
      if (look()) return;
      const t = setInterval(() => look() && clearInterval(t), 100);
    });
  }

  dispose(): void {
    this.flow?.dispose();
    this.flow = null;
  }
}

/** What the command line says about remembering, as lines of the program's own account (cli/README.md). */
export type RememberNote = { state: 'offered' } | { state: 'asked'; name?: never } | { state: 'saved'; name: string } | { state: 'failed'; why: RememberProblem };

/**
 * The command line has nobody to ask: the flag is the yes. With `offer` it offers as soon as the other device can remember; with `accept` it answers an offer from the other side with yes.
 * A computer without the flag says no thanks to an offer, and never offers.
 */
export function programView(o: { offer: boolean; accept: boolean; name?: string; say: (n: RememberNote) => void }): RememberView {
  let offered = false;
  return {
    idle(offer) {
      if (offer && o.offer && !offered) {
        offered = true;
        queueMicrotask(offer);
      }
    },
    form(start, ok) {
      ok(o.name ?? start);
    },
    waiting() {
      o.say({ state: 'offered' });
    },
    asked(_their, start, ok, no) {
      if (!o.accept) return no();
      o.say({ state: 'asked' });
      ok(o.name ?? start);
    },
    saved(name) {
      o.say({ state: 'saved', name });
    },
    problem(why) {
      o.say({ state: 'failed', why });
    },
  };
}

export const selfName = (kv: Keeper): string => readStore(kv).self;
