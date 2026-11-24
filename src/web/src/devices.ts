/**
 * The devices this browser keeps (files-direct-39, docs/PROTOCOL.md "Saved devices"): its own name, and for each saved device the name that device gave itself and the pair
 * secret the two share. Kept in this browser's local storage and nowhere else; clearing the browser's data forgets them. Small, because the page's first script reads it.
 */
import { type Device } from '../../shared/device.ts';
import { PAIR_SECRET_PATTERN, PAIR_ID_PATTERN, PAIR_SIDES, SAVED_DEVICES_MAX, cleanDeviceName, type PairSide } from '../../shared/pair.ts';

export const DEVICES_KEY = 'fd-devices';
const VERSION = 1;

export interface SavedDevice {
  /** The pair id: what our server knows the pair by (a hash of the secret). */
  id: string;
  /** The name that device gave itself. */
  name: string;
  secret: string;
  /** Which side of the pair this browser is (the one that offered is "a"). */
  side: PairSide;
  /** When it was saved (ms). */
  made: number;
}

export interface DeviceStore {
  v: typeof VERSION;
  /** The name this browser gave itself ('' until it did). */
  self: string;
  devices: SavedDevice[];
}

/** What a storage must do: a browser's local storage, or a stand-in in a test. */
export type Keeper = Pick<Storage, 'getItem' | 'setItem'>;

const empty = (): DeviceStore => ({ v: VERSION, self: '', devices: [] });

function valid(d: unknown): SavedDevice | null {
  if (!d || typeof d !== 'object') return null;
  const r = d as Record<string, unknown>;
  const name = cleanDeviceName(r.name);
  if (typeof r.id !== 'string' || !PAIR_ID_PATTERN.test(r.id) || typeof r.secret !== 'string' || !PAIR_SECRET_PATTERN.test(r.secret) || !name) return null;
  if (!PAIR_SIDES.includes(r.side as PairSide)) return null;
  return { id: r.id, name, secret: r.secret, side: r.side as PairSide, made: typeof r.made === 'number' && Number.isFinite(r.made) ? r.made : 0 };
}

/** What is kept. A storage that cannot be read, text that is not JSON, or a version this page does not know gives an empty list; a bad entry is dropped, the rest stay. */
export function readStore(kv: Keeper): DeviceStore {
  try {
    const raw = JSON.parse(kv.getItem(DEVICES_KEY) ?? 'null') as { v?: unknown; self?: unknown; devices?: unknown } | null;
    if (!raw || typeof raw !== 'object' || raw.v !== VERSION || !Array.isArray(raw.devices)) return empty();
    const seen = new Set<string>();
    const devices: SavedDevice[] = [];
    for (const d of raw.devices) {
      const ok = valid(d);
      if (ok && !seen.has(ok.id) && devices.length < SAVED_DEVICES_MAX) {
        seen.add(ok.id);
        devices.push(ok);
      }
    }
    return { v: VERSION, self: cleanDeviceName(raw.self), devices };
  } catch {
    return empty();
  }
}

function write(kv: Keeper, store: DeviceStore): boolean {
  try {
    kv.setItem(DEVICES_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false; // a browser that will not keep it (private mode, no room): the person is told, nothing is half saved
  }
}

export const hasDevices = (kv: Keeper): boolean => readStore(kv).devices.length > 0;

/** Keeps a device. 'full' at the limit (nothing changes), 'failed' when the browser would not keep it; a device with the same pair id is replaced. */
export function addDevice(kv: Keeper, d: SavedDevice): 'ok' | 'full' | 'failed' {
  const store = readStore(kv);
  const rest = store.devices.filter((x) => x.id !== d.id);
  if (rest.length >= SAVED_DEVICES_MAX) return 'full';
  return write(kv, { ...store, devices: [...rest, d] }) ? 'ok' : 'failed';
}

export function removeDevice(kv: Keeper, id: string): boolean {
  const store = readStore(kv);
  if (!store.devices.some((d) => d.id === id)) return false;
  return write(kv, { ...store, devices: store.devices.filter((d) => d.id !== id) });
}

/** The name a saved device gave itself now (it was renamed there). True when the stored name changed; false when it was the same, the device is gone, or the browser would not keep it. */
export function renameDevice(kv: Keeper, id: string, name: string): boolean {
  const clean = cleanDeviceName(name);
  const store = readStore(kv);
  const have = store.devices.find((d) => d.id === id);
  if (!clean || !have || have.name === clean) return false;
  return write(kv, { ...store, devices: store.devices.map((d) => (d.id === id ? { ...d, name: clean } : d)) });
}

/** This browser's own name. */
export function setSelfName(kv: Keeper, name: string): boolean {
  return write(kv, { ...readStore(kv), self: cleanDeviceName(name) });
}

/** A plain guess at a name for this device, to start from: "Chrome on Mac", "Safari on iPhone". */
export function guessName(d: Device): string {
  const where =
    d.system === 'macOS' ? 'Mac' : d.system === 'iOS' ? (d.kind === 'tablet' ? 'iPad' : 'iPhone') : d.system === 'ChromeOS' ? 'Chromebook' : d.system === 'unknown' ? '' : d.system;
  const what = d.browser === 'unknown' || d.browser === 'none' ? '' : d.browser;
  if (what && where) return what + ' on ' + where;
  return where || what || 'This device';
}
