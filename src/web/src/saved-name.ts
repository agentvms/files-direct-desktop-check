/**
 * A saved device's name, kept current (files-direct-39, docs/PROTOCOL.md "Saved devices"). Each time two saved devices meet, each says the name it has now over the connection
 * between the two pages, and the other keeps it. The name never goes through our servers; a device renamed since the last meeting is shown by its new name from the next one.
 */
import { cleanDeviceName } from '../../shared/pair.ts';
import { type Keeper, readStore, renameDevice } from './devices.ts';
import type { PairWire } from './transfer/frames.ts';

export interface SavedNameDeps {
  kv: Keeper;
  /** The pair id of the saved device this room is with. */
  id: string;
  send(m: PairWire): void;
  /** The other device's stored name changed. */
  changed(name: string): void;
}

export function savedName(d: SavedNameDeps) {
  return {
    /** The connection is up: say this device's name now (nothing when it has none). */
    hello(): void {
      const mine = readStore(d.kv).self;
      if (mine) d.send({ t: 'pair', p: 'name', name: mine });
    },
    /** A frame from the other page; anything but a name is not for this. */
    handle(m: PairWire): void {
      if (!m || m.t !== 'pair' || m.p !== 'name') return;
      const name = cleanDeviceName(m.name);
      if (renameDevice(d.kv, d.id, name)) d.changed(name);
    },
  };
}
