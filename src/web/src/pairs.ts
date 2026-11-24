/**
 * How this page talks to our servers about saved devices (files-direct-39, docs/PROTOCOL.md "Saved devices"): make a pair's slot, forget it, and keep one presence socket
 * per saved device so two devices that both have the page open find each other. What goes to the server is the pair id, the check of the forget token, the forget token and a
 * nonce for one meeting's room. Never a name, and never the pair secret.
 */
import { PAIR_NONCE_PATTERN } from '../../shared/pair.ts';
import type { SavedDevice } from './devices.ts';
import type { SignalWhere } from './signal.ts';

const json = { 'content-type': 'application/json' };

/** A page asks its own site with relative addresses; the program (files-direct-40) is given the site's address, and the test lane's mark to add to every request. */
const base = (where?: SignalWhere): string => where?.origin ?? '';
const headersOf = (where?: SignalWhere): Record<string, string> => ({ ...json, ...where?.headers });

/** Makes the pair's slot. True when it was made. */
export async function registerPair(id: string, check: string, where?: SignalWhere): Promise<boolean> {
  try {
    return (await fetch(base(where) + '/api/pairs/' + id, { method: 'POST', headers: headersOf(where), body: JSON.stringify({ check }) })).status === 201;
  } catch {
    return false;
  }
}

/** Forgets the pair on our side, which ends it for both devices. 'ok' also when it was already gone; 'failed' when the server could not be reached or refused. */
export async function forgetPair(id: string, token: string, where?: SignalWhere): Promise<'ok' | 'failed'> {
  try {
    const status = (await fetch(base(where) + '/api/pairs/' + id, { method: 'DELETE', headers: headersOf(where), body: JSON.stringify({ token }) })).status;
    return status === 200 || status === 404 ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}

export interface PresenceHandlers {
  /** The devices to keep a socket for, now. */
  devices(): SavedDevice[];
  /** Who is here changed. */
  changed(): void;
  /** A saved device that is here asks to start a meeting. */
  invite(device: SavedDevice, nonce: string): void;
  /** The pair is gone on the other side (or ran out): the page drops the device. */
  forgotten(device: SavedDevice): void;
}

export interface Presence {
  /** Opens a socket for a device that has none and closes the ones of devices that are gone. */
  sync(): void;
  here(id: string): boolean;
  /** Hands a nonce to the device, if it is here. False when it is not (nothing was sent). */
  invite(id: string, nonce: string): boolean;
  close(): void;
}

/** After a socket that did not open or was lost: how long before trying again. The last value repeats. */
export const PRESENCE_RETRY_MS = [2000, 5000, 15_000, 30_000, 60_000];

interface Link {
  dev: SavedDevice;
  ws: WebSocket | null;
  here: boolean;
  tries: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export function openPresence(h: PresenceHandlers, where?: SignalWhere): Presence {
  const links = new Map<string, Link>();
  let closed = false;
  const address = (dev: SavedDevice, scheme: 'ws' | 'http') => {
    const here = where ? new URL(where.origin) : location;
    const secure = here.protocol === 'https:';
    return (scheme === 'ws' ? (secure ? 'wss:' : 'ws:') : here.protocol) + '//' + here.host + '/api/pairs/' + dev.id + '/ws?side=' + dev.side;
  };

  const drop = (l: Link, forgotten: boolean) => {
    if (l.timer) clearTimeout(l.timer);
    l.timer = null;
    const ws = l.ws;
    l.ws = null;
    links.delete(l.dev.id);
    try {
      ws?.close(1000, 'bye');
    } catch {
      // already closed
    }
    if (forgotten) h.forgotten(l.dev);
  };

  const later = (l: Link, ms = PRESENCE_RETRY_MS[Math.min(l.tries, PRESENCE_RETRY_MS.length - 1)]!) => {
    if (closed || links.get(l.dev.id) !== l) return;
    l.tries++;
    l.timer = setTimeout(() => {
      l.timer = null;
      connect(l);
    }, ms);
  };

  /** A browser hides why a socket was refused: a plain request asks. 404 is the one answer that ends the pair here. */
  const askWhy = async (l: Link) => {
    let status: number | null = null;
    let wait = 0;
    try {
      const r = await fetch(address(l.dev, 'http'), where?.headers ? { headers: where.headers } : undefined);
      status = r.status;
      if (status === 429) wait = (((await r.json().catch(() => ({}))) as { retryAfter?: number }).retryAfter ?? 60) * 1000;
    } catch {
      // no answer: the server blinked, or this device is offline
    }
    if (closed || links.get(l.dev.id) !== l) return;
    if (status === 404) return drop(l, true);
    later(l, wait || undefined);
  };

  const connect = (l: Link) => {
    if (closed || links.get(l.dev.id) !== l) return;
    let opened = false;
    // a page cannot add headers to its socket; the program can (the second argument is the program's own WebSocket), as for the room's socket in signal.ts
    const ws = where?.headers ? new (WebSocket as unknown as new (url: string, o: unknown) => WebSocket)(address(l.dev, 'ws'), { headers: where.headers }) : new WebSocket(address(l.dev, 'ws'));
    l.ws = ws;
    ws.addEventListener('open', () => {
      opened = true;
    });
    ws.addEventListener('message', (e) => {
      if (typeof e.data !== 'string' || links.get(l.dev.id) !== l) return;
      let m: { t?: unknown; here?: unknown; nonce?: unknown };
      try {
        m = JSON.parse(e.data) as typeof m;
      } catch {
        return;
      }
      if (m.t === 'peer') {
        l.tries = 0;
        if (l.here !== (m.here === true)) {
          l.here = m.here === true;
          h.changed();
        }
      } else if (m.t === 'invite' && typeof m.nonce === 'string' && PAIR_NONCE_PATTERN.test(m.nonce)) h.invite(l.dev, m.nonce);
      else if (m.t === 'forgotten') drop(l, true);
    });
    let ended = false;
    const end = () => {
      if (ended || l.ws !== ws) return;
      ended = true;
      l.ws = null;
      if (l.here) {
        l.here = false;
        h.changed();
      }
      if (closed || links.get(l.dev.id) !== l) return;
      if (opened) return later(l, 1000); // it was up and dropped: the next try is soon, and a pair that was forgotten meanwhile answers 404 on it
      void askWhy(l);
    };
    ws.addEventListener('close', end);
    ws.addEventListener('error', () => {
      if (!opened) end();
    });
  };

  return {
    sync() {
      if (closed) return;
      const want = new Map(h.devices().map((d) => [d.id, d]));
      for (const l of [...links.values()]) if (!want.has(l.dev.id)) drop(l, false);
      for (const dev of want.values()) {
        const have = links.get(dev.id);
        if (have) {
          have.dev = dev;
          continue;
        }
        const l: Link = { dev, ws: null, here: false, tries: 0, timer: null };
        links.set(dev.id, l);
        connect(l);
      }
    },
    here: (id) => links.get(id)?.here === true,
    invite(id, nonce) {
      const l = links.get(id);
      if (!l?.here || l.ws?.readyState !== WebSocket.OPEN) return false;
      l.ws.send(JSON.stringify({ t: 'invite', nonce }));
      return true;
    },
    close() {
      closed = true;
      for (const l of [...links.values()]) drop(l, false);
    },
  };
}
