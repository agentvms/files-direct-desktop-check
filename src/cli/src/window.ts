/**
 * The Files Direct window (files-direct-30): what the program does between a right-click and the page it shows. `Desk` is the one thing that knows the
 * state of the window: it starts the run (the same engine as `send`, `ask` and `receive`), keeps the account of it in plain words, and answers the page.
 * `serveDesk` shows it on this computer's own address only (127.0.0.1, a random port, an unguessable word in the path) and refuses anything that
 * did not come from the page it served: a wrong word, another Host (a web page that points its own name at 127.0.0.1), another Origin, a request
 * that is not JSON. The page can press buttons; it cannot name a file or a folder. Paths come only from the program's own arguments.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { cleanNote } from '../../shared/ask.ts';
import { formatCode } from '../../shared/code.ts';
import { doorOf } from './door.ts';
import { etaText, size } from './format.ts';
import { qrSvg } from './qr.ts';
import { cleanDeviceName } from '../../shared/pair.ts';
import type { SavedDevice } from '../../web/src/devices.ts';
import type { RememberView } from '../../web/src/remember.ts';
import { SAVED } from '../../web/src/saved-copy.ts';
import { PairHost, guessComputerName } from './pair-host.ts';
import { APP_SAVED } from './window-copy.ts';
import { type ProgramEvent, type Result, type Run, type RoomEnv, ask, receive, send } from './room.ts';
import { type SavedBook, meetingSecret } from './saved.ts';
import type { Picked, Skipped } from './fs-source.ts';
import { EXIT, type Outcome, reasonText } from './words.ts';
import { windowPage, windowPolicy } from './window-page.ts';

export type Phase = 'home' | 'waiting' | 'connecting' | 'transferring' | 'done' | 'failed' | 'cancelled';
export type Job = 'send' | 'ask' | 'receive';

/** What the window shows about remembering the device on the other side (files-direct-40). Words are the site's own (web/src/saved-copy.ts). */
export type RememberCard =
  | { state: 'idle' }
  | { state: 'form'; start: string }
  | { state: 'waiting' }
  | { state: 'asked'; text: string; start: string }
  | { state: 'saved'; text: string }
  | { state: 'problem'; text: string; again: boolean };


/** Everything the page draws, already in words. Names are data from the other side or from this computer: the page shows them as text. */
export interface Snapshot {
  phase: Phase;
  job: Job | null;
  title: string;
  sub: string;
  status: string;
  message: string;
  link: string | null;
  code: string | null;
  qr: string;
  items: { name: string; size: string }[];
  more: number;
  knock: boolean;
  progress: { done: number; total: number };
  progressText: string;
  progressFile: string;
  where: string;
  /** Saved devices (files-direct-40): the start page lists them, a room offers to remember the device on the other side, and a saved device that asks to send is answered here. Absent from a window with none. */
  devices?: { id: string; name: string }[];
  remember?: RememberCard;
  /** A batch from a saved device waits for the person's yes. */
  offer?: boolean;
}

export interface DeskOptions {
  env: RoomEnv;
  /** The devices this computer remembers. Without it, nothing of saved devices is offered. */
  book?: SavedBook;
  /** A saved device asked to send (the program that keeps watching hands it over): the window opens on that meeting. */
  invited?: { dev: SavedDevice; nonce: string };
  /** Where what the window receives is saved. Chosen by the program (the person's Downloads folder, or --to), never by the page. */
  downloads: string;
  /** What to send: from the program's arguments. None: the window opens on its start page. */
  picked?: { files: Picked[]; skipped: Skipped[] };
  /** How long a room waits for someone, in ms. */
  waitMs?: number;
  /** How long a typed code waits to be let in or turned away, in ms. */
  knockMs?: number;
}

const MAX_SHOWN = 40;
const files = (n: number): string => (n === 1 ? '1 file' : n + ' files');

export class Desk {
  /** Resolves with the program's exit status once the window is done (closed, or abandoned). */
  readonly ended: Promise<number>;
  private resolveEnded!: (code: number) => void;
  private run: Run | null = null;
  private result: Result | null = null;
  private closing = false;
  /** A job is being set up (its folder made) and has not begun yet: no second one may start meanwhile. */
  private starting = false;
  private s: Snapshot;
  private answer: ((yes: boolean) => void) | null = null;
  private accepted = false;
  private sentList: { name: string; size: string }[] = [];
  private sentMore = 0;
  private savedCount = 0;
  private who = '';
  private how = '';
  /** What the buttons of the remember card press now (set by the view below), and the answer to a batch from a saved device. */
  private card: { offer?: () => void; ok?: (name: string) => void; cancel?: () => void; no?: () => void; again?: () => void } = {};
  private offerAnswer: ((yes: boolean) => void) | null = null;
  /** The name of the saved device this window was opened for, while it is that meeting. */
  private fromSaved = '';

  constructor(private readonly o: DeskOptions) {
    this.ended = new Promise((r) => (this.resolveEnded = r));
    this.s = this.fresh('home');
    this.s.where = o.downloads;
    if (o.invited) void this.startJob(() => this.startSaved(o.invited!.dev, o.invited!.nonce));
    else if (o.picked && o.picked.files.length > 0) this.startSend(o.picked.files, o.picked.skipped);
  }

  private fresh(phase: Phase): Snapshot {
    return { phase, job: null, title: 'Files Direct', sub: '', status: '', message: '', link: null, code: null, qr: '', items: [], more: 0, knock: false, progress: { done: 0, total: 0 }, progressText: '', progressFile: '', where: this.o.downloads };
  }

  snapshot(): Snapshot {
    const snap: Snapshot = { ...this.s, items: [...this.s.items], progress: { ...this.s.progress } };
    // the start page lists the devices this computer remembers; with none, it is the page it always was
    const kept = this.s.phase === 'home' ? (this.o.book?.devices() ?? []) : [];
    if (kept.length > 0) snap.devices = kept.map((d) => ({ id: d.id, name: d.name }));
    return snap;
  }

  // ---- what the page presses --------------------------------------------------------------------

  async act(body: unknown): Promise<{ ok: boolean; error?: string }> {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    switch (b.do) {
      case 'cancel':
        if (this.run && !this.result) this.run.cancel();
        else if (!this.run) this.finishHome();
        return { ok: true };
      case 'close':
        this.close();
        return { ok: true };
      case 'allow':
      case 'turn-away':
        this.answer?.(b.do === 'allow');
        return { ok: true };
      case 'accept':
      case 'no-thanks':
        this.offerAnswer?.(b.do === 'accept');
        return { ok: true };
      case 'remember':
        this.card.offer?.();
        return { ok: true };
      case 'remember-ok':
        this.card.ok?.(typeof b.name === 'string' ? b.name : '');
        return { ok: true };
      case 'remember-cancel':
        this.card.cancel?.();
        return { ok: true };
      case 'remember-no':
        this.card.no?.();
        return { ok: true };
      case 'remember-again':
        this.card.again?.();
        return { ok: true };
      case 'forget': {
        const dev = this.o.book?.devices().find((d) => d.id === b.id);
        if (!dev || !this.o.book) return { ok: false, error: 'That device is not remembered here.' };
        await this.o.book.forget(dev);
        return { ok: true };
      }
      case 'ask': {
        const note = typeof b.note === 'string' ? b.note : '';
        return this.startJob(() => this.startAsk(note));
      }
      case 'receive': {
        const door = typeof b.target === 'string' ? doorOf(b.target.trim(), this.o.env.origin) : null;
        if (!door) return { ok: false, error: 'That is not a link from this site or a nine-digit code.' };
        return this.startJob(() => this.startReceive(door));
      }
      default:
        return { ok: false, error: 'That is not something this window does.' };
    }
  }

  /** The window went away (closed, or the page stopped answering): what is running is cancelled and the program ends. */
  abandon(): void {
    this.close();
  }

  private close(): void {
    if (this.closing) return;
    this.closing = true;
    if (this.run && !this.result) {
      this.run.cancel();
      void this.run.done.then(() => this.resolveEnded(this.code()));
    } else this.resolveEnded(this.code());
  }

  private code(): number {
    return this.result ? EXIT[this.result.outcome] : 0;
  }

  private finishHome(): void {
    this.close();
  }

  // ---- the three jobs ---------------------------------------------------------------------------------

  /** The question "let this person in?". It ends when it is answered, when it times out, or when the visitor it was about has gone: it never touches a newer question. */
  private letIn = (gone: AbortSignal): Promise<boolean> =>
    new Promise((resolve) => {
      const done = (yes: boolean) => {
        clearTimeout(timer);
        gone.removeEventListener('abort', onGone);
        if (this.answer === done) {
          this.answer = null;
          this.s.knock = false;
        }
        resolve(yes);
      };
      const onGone = () => done(false);
      const timer = setTimeout(() => done(false), this.o.knockMs ?? 60_000);
      gone.addEventListener('abort', onGone, { once: true });
      this.answer = done;
      this.s.knock = true;
    });

  private startSend(list: Picked[], skipped: Skipped[]): void {
    const total = list.reduce((n, f) => n + f.size, 0);
    this.sentList = list.slice(0, MAX_SHOWN).map((f) => ({ name: f.name, size: size(f.size) }));
    this.sentMore = Math.max(0, list.length - MAX_SHOWN);
    this.s = { ...this.fresh('connecting'), job: 'send', title: `Send ${files(list.length)} (${size(total)})`, sub: 'Nothing leaves this computer until the other device has joined and you see it accept.', status: 'Opening a room…', items: this.sentList, more: this.sentMore, progress: { done: 0, total } };
    this.begin(send(this.o.env, { files: list, skipped, letIn: this.letIn, waitMs: this.o.waitMs ?? 30 * 60_000, pair: this.makePair() }, (e) => this.onEvent(e)), 'send');
  }

  /**
   * One job at a time. The place is taken before anything is awaited, so a double click or two tabs cannot start two engines; it is given up if the
   * folder cannot be made, and a window closed while the folder is being made starts nothing.
   */
  private async startJob(begin: () => void | Promise<void>): Promise<{ ok: boolean; error?: string }> {
    if (this.starting || this.run || this.closing) return { ok: false, error: 'Something is already open in this window.' };
    this.starting = true;
    try {
      await mkdir(this.o.downloads, { recursive: true });
      if (this.closing) return { ok: false, error: 'The window was closed.' };
      await begin();
      return { ok: true };
    } catch {
      return { ok: false, error: 'The folder for saved files could not be made.' };
    } finally {
      this.starting = false;
    }
  }

  private startAsk(note: string): void {
    const asked = cleanNote(note);
    this.s = { ...this.fresh('connecting'), job: 'ask', title: 'Asking for files', sub: (asked ? `"${asked}". ` : '') + 'The files come straight to ' + this.o.downloads + '. Nothing is replaced.', status: 'Opening a room…' };
    this.begin(ask(this.o.env, { note: asked, dest: this.o.downloads, maxFiles: 1000, letIn: this.letIn, waitMs: this.o.waitMs ?? 30 * 60_000, pair: this.makePair() }, (e) => this.onEvent(e)), 'ask');
  }

  private startReceive(door: NonNullable<ReturnType<typeof doorOf>>): void {
    this.s = { ...this.fresh('connecting'), job: 'receive', title: 'Receiving files', sub: 'They are saved straight to ' + this.o.downloads + ' and checked. Nothing is replaced.', status: 'Connecting…' };
    this.begin(receive(this.o.env, { target: door, dest: this.o.downloads, pair: this.makePair() }, (e) => this.onEvent(e)), 'receive');
  }

  /** A saved device asked to send: join its meeting, and take nothing before the person at the window says yes. */
  private async startSaved(dev: SavedDevice, nonce: string): Promise<void> {
    const secret = await meetingSecret(dev, nonce);
    if (this.closing) return;
    this.fromSaved = dev.name;
    this.s = { ...this.fresh('connecting'), job: 'receive', title: APP_SAVED.invited(dev.name), sub: 'They are saved straight to ' + this.o.downloads + ' and checked. Nothing is replaced.', status: APP_SAVED.connecting(dev.name) };
    const pair = new PairHost({ kv: this.o.book!.kv, where: this.o.book!.where, guess: guessComputerName, saved: dev });
    const confirm = () =>
      new Promise<boolean>((resolve) => {
        this.s.offer = true;
        this.offerAnswer = (yes) => {
          this.offerAnswer = null;
          delete this.s.offer;
          resolve(yes);
        };
      });
    this.begin(receive(this.o.env, { target: { kind: 'link', secret }, dest: this.o.downloads, pair, confirm }, (e) => this.onEvent(e)), 'receive');
  }

  /** The saved-devices code for a run in a normal room (a link, a code or a QR code): it offers to remember the device on the other side. None when the window was given no file of saved devices. */
  private makePair(): PairHost | undefined {
    const book = this.o.book;
    return book ? new PairHost({ kv: book.kv, where: book.where, guess: guessComputerName, view: this.rememberView() }) : undefined;
  }

  /** What the remember card shows and what its buttons press: the page asks the program, so the person's answers go through here. */
  private rememberView(): RememberView {
    const show = (c: RememberCard | null, fns: Desk['card'] = {}) => {
      this.card = fns;
      if (c) this.s.remember = c;
      else delete this.s.remember;
    };
    return {
      idle: (offer) => show(offer ? { state: 'idle' } : null, offer ? { offer } : {}),
      form: (start, ok, cancel) => show({ state: 'form', start }, { ok, cancel }),
      waiting: () => show({ state: 'waiting' }),
      asked: (their, start, ok, no) => show({ state: 'asked', start, text: SAVED.asked(this.who || 'another device', cleanDeviceName(their)) }, { ok, no }),
      saved: (their) => show({ state: 'saved', text: APP_SAVED.saved(their) }),
      problem: (why, again) =>
        show(
          { state: 'problem', again: again !== null, text: why === 'full' ? 'One of you already remembers 10 devices. Forget one (open the Files Direct window with nothing in it, under Saved devices), then try again.' : why === 'not-saved' ? 'This computer would not keep it, so nothing was saved.' : SAVED.problem(why) },
          again ? { again } : {},
        ),
    };
  }

  private begin(run: Run, job: Job): void {
    this.run = run;
    this.accepted = false;
    void run.done.then((r) => this.over(r, job));
  }

  // ---- what the run says -----------------------------------------------------------------------------

  private onEvent(e: ProgramEvent): void {
    const s = this.s;
    switch (e.event) {
      case 'room':
        s.phase = 'waiting';
        s.link = e.link;
        s.code = formatCode(e.code);
        s.qr = qrSvg(e.link.replace('/r/#', '/r/?v=q#')); // a marker outside the secret says the second device came in by the QR code, as on the page
        s.status = s.job === 'ask' ? 'Waiting for someone to open the link and choose files…' : 'Waiting for the other device…';
        break;
      case 'joined':
        s.phase = 'connecting';
        this.who = e.device;
        s.status = this.connectedText();
        break;
      case 'knock':
        s.status = e.allowed ? 'Someone typed the code and was let in.' : 'Someone typed the code and was turned away.';
        break;
      case 'knocking':
        s.status = 'Waiting for the sender to let you in…';
        break;
      case 'connected':
        s.phase = 'connecting';
        this.how = e.route === 'relay' ? 'through our servers' : 'directly';
        s.status = this.connectedText();
        break;
      case 'offered':
        if (s.job !== 'send') {
          s.items = e.names.slice(0, MAX_SHOWN).map((n) => ({ name: n.name, size: size(n.size) }));
          s.more = Math.max(0, e.files - MAX_SHOWN);
          s.title = this.fromSaved ? APP_SAVED.offer(this.fromSaved, files(e.files), size(e.bytes)) : `Receiving ${files(e.files)} (${size(e.bytes)})`;
          if (this.fromSaved) s.sub = APP_SAVED.offerSub;
        }
        break;
      case 'accepted':
        this.accepted = true;
        s.phase = 'transferring';
        break;
      case 'progress':
        this.accepted = true;
        s.phase = 'transferring';
        s.progress = { done: e.done, total: e.total };
        s.progressText = `${size(e.done)} of ${size(e.total)}  ${size(e.speed)}/s${etaText(e.eta)}`;
        s.progressFile = e.file;
        break;
      case 'file':
        if (e.path) this.savedCount++;
        break;
      default:
        break;
    }
    if (this.run && s.phase !== 'transferring' && s.phase !== 'waiting') s.knock = s.knock && this.answer !== null;
  }

  private connectedText(): string {
    const job = this.s.job;
    return `Connected${this.how ? ' ' + this.how : ''}${this.who ? ' with ' + this.who : ''}. ${job === 'send' ? 'Waiting for them to accept…' : 'Waiting for the files…'}`;
  }

  private over(r: Result, job: Job): void {
    this.result = r;
    const s = this.s;
    s.knock = false;
    this.answer?.(false);
    this.offerAnswer?.(false);
    delete s.offer;
    // a card that says it was remembered, or why not, stays on the closing screen; a question that was never answered goes
    if (s.remember && s.remember.state !== 'saved' && s.remember.state !== 'problem') delete s.remember;
    this.card = {};
    const ok = r.outcome === 'finished';
    s.phase = ok ? 'done' : r.outcome === 'cancelled' || r.outcome === 'closed' ? 'cancelled' : 'failed';
    s.link = null;
    s.qr = '';
    s.progress = { done: 0, total: 0 };
    if (ok) {
      s.title = job === 'send' ? 'Sent' : 'Saved';
      s.message = job === 'send' ? `${files(r.files)} arrived and every file was checked.` : `${files(r.files)} saved to ${this.o.downloads} and every file was checked.`;
    } else {
      s.title = s.phase === 'cancelled' ? 'Cancelled' : 'It did not work';
      s.message = s.phase === 'cancelled' && job !== 'receive' && !this.accepted ? 'Nothing was sent.' : s.phase === 'cancelled' && job === 'receive' && this.savedCount === 0 ? 'Nothing was saved.' : cancelledOrFailed(r.outcome, r.message);
    }
    if (job === 'send' && ok) s.items = this.sentList;
    else if (job !== 'send' && r.saved.length === 0) s.items = [];
  }
}

function cancelledOrFailed(outcome: Outcome, message: string): string {
  return outcome === 'cancelled' ? reasonText('cancelled') : message;
}

// ---- the page's own server ---------------------------------------------------------------------------

export interface DeskServer {
  /** The one address the window opens: http://127.0.0.1:<port>/w/<word>/ */
  url: string;
  port: number;
  close(): Promise<void>;
}

const TOKEN_BYTES = 24;
const MAX_BODY = 4096;

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * The checks, in the order a request meets them. Each refusal is a status and nothing else: no page, no hint of what was wrong.
 * - 404: the path is not the page's own (the word in it is the secret).
 * - 403: Host is not this address and port (a web page cannot make our address answer under its own name).
 * - 403: Origin is there and is not this page (a page from another site cannot press the buttons), or a press has no Origin and no same-origin mark.
 * - 415: a press that is not JSON (a form from another site cannot send JSON without asking first, and nothing here answers that question).
 */
export function refusal(req: Pick<IncomingMessage, 'method' | 'url' | 'headers'>, port: number, word: string): number | null {
  const url = new URL(req.url ?? '/', 'http://x');
  const prefix = `/w/${word}/`;
  const p = url.pathname;
  if (!(p.length >= prefix.length && same(p.slice(0, prefix.length), prefix))) return 404;
  const host = req.headers.host ?? '';
  if (host !== `127.0.0.1:${port}`) return 403;
  const origin = req.headers.origin;
  const own = `http://127.0.0.1:${port}`;
  if (origin !== undefined && origin !== own) return 403;
  if (req.method === 'POST') {
    if (origin !== own && req.headers['sec-fetch-site'] !== 'same-origin') return 403;
    if (!/^application\/json(;|$)/i.test(req.headers['content-type'] ?? '')) return 415;
  } else if (req.method !== 'GET') return 405;
  return null;
}

export function serveDesk(desk: Desk, opts: { idleMs?: number; firstMs?: number; onGone?: () => void } = {}): Promise<DeskServer> {
  const word = randomBytes(TOKEN_BYTES).toString('base64url');
  let seen = Date.now();
  let loaded = false;
  const server: Server = createServer((req, res) => {
    const port = (server.address() as { port: number }).port;
    const refuse = refusal(req, port, word);
    const send = (status: number, type: string, body: string, extra: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin', ...extra });
      res.end(body);
    };
    if (refuse !== null) return send(refuse, 'text/plain; charset=utf-8', '');
    const path = new URL(req.url ?? '/', 'http://x').pathname.slice(`/w/${word}/`.length);
    if (req.method === 'GET' && path === '') {
      loaded = true;
      seen = Date.now();
      const nonce = randomBytes(16).toString('base64');
      return send(200, 'text/html; charset=utf-8', windowPage(nonce), { 'content-security-policy': windowPolicy(nonce), 'x-frame-options': 'DENY' });
    }
    if (req.method === 'GET' && path === 'state') {
      seen = Date.now();
      return send(200, 'application/json; charset=utf-8', JSON.stringify(desk.snapshot()));
    }
    if (req.method === 'POST' && path === 'act') {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) req.destroy();
        else chunks.push(c);
      });
      req.on('end', () => {
        let body: unknown;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          return send(400, 'application/json', '{"ok":false}');
        }
        seen = Date.now();
        desk.act(body).then((r) => send(200, 'application/json; charset=utf-8', JSON.stringify(r)), () => send(500, 'application/json', '{"ok":false}'));
      });
      return;
    }
    return send(404, 'text/plain; charset=utf-8', '');
  });
  const idle = opts.idleMs ?? 30_000;
  const first = opts.firstMs ?? 120_000;
  const started = Date.now();
  const watch = setInterval(() => {
    const gone = loaded ? Date.now() - seen > idle : Date.now() - started > first;
    if (gone) {
      clearInterval(watch);
      opts.onGone?.();
      desk.abandon();
    }
  }, 1000);
  watch.unref();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        url: `http://127.0.0.1:${port}/w/${word}/`,
        port,
        close: () =>
          new Promise<void>((r) => {
            clearInterval(watch);
            server.closeAllConnections();
            server.close(() => r());
          }),
      });
    });
  });
}
