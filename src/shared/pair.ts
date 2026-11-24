/**
 * Saved devices (files-direct-39, docs/PROTOCOL.md "Saved devices"). Two browsers that chose to remember each other share one random pair secret, kept only in the two
 * browsers. What the server sees is a name derived from it one way (the pair id), a check that a forget request is the right one, and nothing about who or what the devices are.
 */
import { DAY_MS, HOUR_MS } from './config.ts';
import { base64url } from './secret.ts';

export const PAIR_SECRET_BYTES = 32;
export const PAIR_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** The pair id the server knows a saved pair by, and the nonce that makes one meeting's room (both are 16 random or derived bytes). */
export const PAIR_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const PAIR_NONCE_PATTERN = /^[A-Za-z0-9_-]{22}$/;
/** What a forget request carries (32 bytes, derived from the pair secret) and the check the server keeps of it (SHA-256, base64url). */
export const PAIR_FORGET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const PAIR_CHECK_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** The two sides of a pair. The device that offered is "a", the one that accepted is "b": a page opens one presence socket per saved device, as its own side. */
export const PAIR_SIDES = ['a', 'b'] as const;
export type PairSide = (typeof PAIR_SIDES)[number];

/** A saved pair is kept this long after the two devices last met (refreshed at every meeting); a pair made through the test lane for one hour. */
export const PAIR_KEEP_MS = 180 * DAY_MS;
export const PAIR_TEST_KEEP_MS = HOUR_MS;
/** The most a presence frame (an invitation) may weigh, in bytes. */
export const PAIR_FRAME_MAX = 256;

/** Saved devices one browser keeps, and the longest name a device may give itself (characters). */
export const SAVED_DEVICES_MAX = 10;
export const DEVICE_NAME_MAX = 40;

/** Presence sockets and pair changes one hashed address may make per hour. */
export const PAIR_OPEN_LIMIT_HOUR = 600;
export const PAIR_CHANGE_LIMIT_HOUR = 60;

const text = new TextEncoder();
async function digest(label: string, value: string, bytes: number): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', text.encode(label + value))).slice(0, bytes));
}

/** 256 random bits from the crypto API, base64url (43 characters). */
export function generatePairSecret(): string {
  const bytes = new Uint8Array(PAIR_SECRET_BYTES);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/** A fresh nonce for one meeting: 128 random bits. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/** The pair id: the first 16 bytes of SHA-256 over a fixed label and the pair secret, like the room id. The server names the pair's slot by it. */
export const pairIdFromSecret = (secret: string): Promise<string> => digest('files-direct pair', secret, 16);

/** What a device sends to forget the pair: derived from the secret, so only a device that holds the secret can. The server never sees the secret itself. */
export const forgetTokenFromSecret = (secret: string): Promise<string> => digest('files-direct forget', secret, 32);

/** What the server keeps in place of the forget token: a hash of it. */
export const forgetCheck = (token: string): Promise<string> => digest('files-direct forget check', token, 32);

/**
 * The secret of the room one meeting uses: both devices derive it from the pair secret and the nonce the sender chose, so the link, QR code and nine-digit code are not needed
 * and the server (which sees the nonce and the room's own id, never this secret) cannot open the room.
 */
export const roomSecretFromPair = (secret: string, nonce: string): Promise<string> => digest('files-direct saved room', secret + ':' + nonce, 16);

/** A name a person gave a device: plain text, one line, no control characters, at most DEVICE_NAME_MAX characters. '' when nothing is left. It is only ever shown as text. */
export function cleanDeviceName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const one = raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  return [...one].slice(0, DEVICE_NAME_MAX).join('').trim();
}
