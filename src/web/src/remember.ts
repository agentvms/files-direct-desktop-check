/**
 * The two pages agreeing to remember each other (files-direct-39, docs/PROTOCOL.md "Saved devices"). It talks over the connection between the two pages only; nothing here
 * goes through our servers except the pair's slot being made (a check of a forget token) or deleted. The one that offered makes the pair secret and says it over the connection
 * once the other said yes; each side keeps the other's name and the secret in this browser.
 */
import { cleanDeviceName, forgetCheck, forgetTokenFromSecret, generatePairSecret, pairIdFromSecret, PAIR_SECRET_PATTERN, SAVED_DEVICES_MAX } from '../../shared/pair.ts';
import type { PairWire } from './transfer/frames.ts';
import { type Keeper, type SavedDevice, addDevice, readStore, setSelfName } from './devices.ts';

/** Why a try ended without a saved device. */
export type RememberProblem = 'declined' | 'failed' | 'full' | 'busy' | 'timed-out' | 'not-saved';

/** What a person sees; remember-ui.ts draws it, a test records it. */
export interface RememberView {
  /** Nothing is going on: a button that starts it, or nothing at all when it cannot be offered now. */
  idle(offer: (() => void) | null): void;
  /** This side asks: a name for this device, then Remember or Cancel. */
  form(start: string, ok: (name: string) => void, cancel: () => void): void;
  /** The other side was asked and has not answered. */
  waiting(): void;
  /** The other side asks: the name it gave itself, a name for this device, then Remember or No thanks. */
  asked(theirName: string, start: string, ok: (name: string) => void, no: () => void): void;
  saved(theirName: string): void;
  /** It ended without a saved device. again tries once more (null when it cannot be offered). */
  problem(why: RememberProblem, again: (() => void) | null): void;
}

export interface RememberDeps {
  kv: Keeper;
  view: RememberView;
  send(m: PairWire): void;
  /** A plain guess at this device's name, to start the field from. */
  guess(): string;
  /** Makes the pair's slot on our side (the check of its forget token); true when it was made. */
  register(id: string, check: string): Promise<boolean>;
  /** Takes the slot away again (a try that did not finish). */
  unregister(id: string, token: string): Promise<void>;
  /** Runs a function later; gives back how to cancel it. */
  after(fn: () => void, ms: number): () => void;
  /** A device was saved on this side. */
  saved(d: SavedDevice): void;
}

export const ASK_WAIT_MS = 90_000;
export const SECRET_WAIT_MS = 20_000;

type Mode = 'idle' | 'form' | 'waiting' | 'asked' | 'accepted' | 'registering' | 'sent';

const FALLBACK = 'Another device';

export class RememberFlow {
  private mode: Mode = 'idle';
  private available = false;
  private theirs = '';
  private made: { id: string; token: string; secret: string } | null = null;
  private stop: (() => void) | null = null;
  private ended = false;

  constructor(private readonly d: RememberDeps) {}

  /** A try is under way (a question asked or waiting, a pair being made): the program's run does not end before it settles. */
  get busy(): boolean {
    return !this.ended && this.mode !== 'idle';
  }

  /** Whether remembering may be offered now (connected, the other page can do it, and this room is not itself a saved one). */
  setAvailable(on: boolean): void {
    this.available = on;
    if (this.mode === 'idle') this.showIdle();
  }

  private showIdle(): void {
    this.d.view.idle(this.available ? () => this.begin() : null);
  }

  private timer(ms: number, fn: () => void): void {
    this.stop?.();
    this.stop = this.d.after(() => {
      this.stop = null;
      fn();
    }, ms);
  }

  private clear(): void {
    this.stop?.();
    this.stop = null;
  }

  private reset(): void {
    this.clear();
    this.mode = 'idle';
    this.made = null;
  }

  private end(why: RememberProblem): void {
    const made = this.made;
    this.reset();
    if (made) void this.d.unregister(made.id, made.token).catch(() => {});
    this.d.view.problem(why, this.available ? () => this.begin() : null);
  }

  private full(): boolean {
    return readStore(this.d.kv).devices.length >= SAVED_DEVICES_MAX;
  }

  private start(): string {
    return readStore(this.d.kv).self || this.d.guess();
  }

  /** The person pressed "Remember this device". */
  private begin(): void {
    if (this.mode !== 'idle' || this.ended) return;
    if (this.full()) return this.d.view.problem('full', null);
    this.mode = 'form';
    this.d.view.form(
      this.start(),
      (name) => {
        const mine = cleanDeviceName(name) || this.d.guess();
        setSelfName(this.d.kv, mine);
        this.mode = 'waiting';
        this.d.view.waiting();
        this.d.send({ t: 'pair', p: 'offer', name: mine });
        this.timer(ASK_WAIT_MS, () => {
          this.d.send({ t: 'pair', p: 'cancel', why: 'timed-out' });
          this.end('timed-out');
        });
      },
      () => {
        this.reset();
        this.showIdle();
      },
    );
  }

  /** A frame from the other page. Anything out of order, or not shaped right, is ignored. */
  async handle(m: PairWire): Promise<void> {
    if (this.ended || !m || m.t !== 'pair') return;
    switch (m.p) {
      case 'offer':
        return this.onOffer(m);
      case 'accept':
        return this.onAccept(m);
      case 'decline':
        if (this.mode === 'waiting') this.end('declined');
        return;
      case 'secret':
        return this.onSecret(m);
      case 'done':
        return this.onDone();
      case 'cancel':
        if (this.mode !== 'idle') this.end(m.why === 'full' ? 'full' : m.why === 'busy' ? 'busy' : m.why === 'timed-out' ? 'timed-out' : 'failed');
        return;
      default:
        return;
    }
  }

  private onOffer(m: PairWire): void {
    if (this.mode !== 'idle' && this.mode !== 'form') {
      // both sides asked at once: neither goes on
      this.d.send({ t: 'pair', p: 'cancel', why: 'busy' });
      return this.end('busy');
    }
    if (this.full()) {
      this.d.send({ t: 'pair', p: 'cancel', why: 'full' });
      this.reset();
      return this.d.view.problem('full', this.available ? () => this.begin() : null);
    }
    this.reset();
    this.mode = 'asked';
    this.theirs = cleanDeviceName(m.name) || FALLBACK;
    this.d.view.asked(
      this.theirs,
      this.start(),
      (name) => {
        const mine = cleanDeviceName(name) || this.d.guess();
        setSelfName(this.d.kv, mine);
        this.mode = 'accepted';
        this.d.view.waiting();
        this.d.send({ t: 'pair', p: 'accept', name: mine });
        this.timer(SECRET_WAIT_MS, () => {
          this.d.send({ t: 'pair', p: 'cancel', why: 'timed-out' });
          this.end('failed');
        });
      },
      () => {
        this.d.send({ t: 'pair', p: 'decline' });
        this.reset();
        this.showIdle();
      },
    );
  }

  private async onAccept(m: PairWire): Promise<void> {
    if (this.mode !== 'waiting') return;
    this.theirs = cleanDeviceName(m.name) || FALLBACK;
    if (this.full()) {
      this.d.send({ t: 'pair', p: 'cancel', why: 'full' });
      return this.end('full');
    }
    this.clear();
    this.mode = 'registering';
    const secret = generatePairSecret();
    const id = await pairIdFromSecret(secret);
    const token = await forgetTokenFromSecret(secret);
    this.made = { id, token, secret };
    let ok: boolean;
    try {
      ok = await this.d.register(id, await forgetCheck(token));
    } catch {
      ok = false;
    }
    if (this.mode !== 'registering') {
      // the other side gave up while this waited: the slot is taken away again
      if (ok) await this.d.unregister(id, token).catch(() => {});
      return;
    }
    if (!ok) {
      this.d.send({ t: 'pair', p: 'cancel', why: 'failed' });
      this.made = null;
      return this.end('failed');
    }
    this.mode = 'sent';
    this.d.send({ t: 'pair', p: 'secret', secret });
    this.timer(SECRET_WAIT_MS, () => {
      this.d.send({ t: 'pair', p: 'cancel', why: 'timed-out' });
      this.end('failed');
    });
  }

  private async onSecret(m: PairWire): Promise<void> {
    if (this.mode !== 'accepted') return;
    if (typeof m.secret !== 'string' || !PAIR_SECRET_PATTERN.test(m.secret)) {
      this.d.send({ t: 'pair', p: 'cancel', why: 'failed' });
      return this.end('failed');
    }
    const id = await pairIdFromSecret(m.secret);
    if (this.mode !== 'accepted') return;
    const kept = addDevice(this.d.kv, { id, name: this.theirs, secret: m.secret, side: 'b', made: Date.now() });
    if (kept !== 'ok') {
      this.d.send({ t: 'pair', p: 'cancel', why: kept === 'full' ? 'full' : 'failed' });
      return this.end(kept === 'full' ? 'full' : 'not-saved');
    }
    this.d.send({ t: 'pair', p: 'done' });
    this.finish(id, m.secret, 'b');
  }

  private onDone(): void {
    const made = this.made;
    if (this.mode !== 'sent' || !made) return;
    const kept = addDevice(this.d.kv, { id: made.id, name: this.theirs, secret: made.secret, side: 'a', made: Date.now() });
    if (kept !== 'ok') {
      this.d.send({ t: 'pair', p: 'cancel', why: 'failed' });
      return this.end(kept === 'full' ? 'full' : 'not-saved');
    }
    this.made = null; // kept: the slot stays
    this.finish(made.id, made.secret, 'a');
  }

  private finish(id: string, secret: string, side: 'a' | 'b'): void {
    this.reset();
    this.d.view.saved(this.theirs);
    this.d.saved({ id, name: this.theirs, secret, side, made: Date.now() });
  }

  /** The room is over: nothing is left running, and a slot made for a try that did not finish is taken away. */
  dispose(): void {
    this.ended = true;
    this.clear();
    const made = this.made;
    this.made = null;
    if (made && this.mode !== 'idle') void this.d.unregister(made.id, made.token).catch(() => {});
  }
}
