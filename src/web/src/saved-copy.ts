/** Every sentence of the saved-devices screens (docs/WORDING.md). Loaded with the room, or with the saved-devices screen, not with the page's first script. */
import { SAVED_DEVICES_MAX } from '../../shared/pair.ts';
import type { RememberProblem } from './remember.ts';

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const SAVED = {
  remember: 'Remember this device',
  rememberHint: 'Next time you are both here, you can send between these two with no link or code.',
  nameLabel: 'Name for this device',
  nameHelp: 'The other device sees this name. We never do.',
  ok: 'Remember',
  tryAgain: 'Try again',
  cancel: 'Cancel',
  noThanks: 'No thanks',
  waiting: 'Waiting for the other device to say yes.',
  asked: (label: string, name: string) => capital(label) + ' called ' + name + ' wants to remember this device, so the two of you can send files with no link or code.',
  savedTitle: 'Remembered',
  saved: (name: string) => 'When ' + name + ' has Files Direct open, you will see "Send to ' + name + '" on the home page, with no link or code. To forget it, open Saved devices in the menu.',
  problem: (why: RememberProblem): string =>
    ({
      declined: 'The other device said no thanks. Nothing was saved.',
      failed: 'That did not work, so nothing was saved. You can try again.',
      full: 'One of you already remembers ' + SAVED_DEVICES_MAX + ' devices. Forget one under Saved devices in the menu, then try again.',
      busy: 'You both asked at once. Press Remember this device on just one of them.',
      'timed-out': 'No answer, so nothing was saved.',
      'not-saved': 'This browser would not keep it, so nothing was saved. Private browsing can cause this.',
    })[why],
  sendTo: (name: string) => 'Send to ' + name,
  notHere: (name: string) => name + ' closed the page. Open it there and try again.',
  waitingTitle: (name: string) => 'Sending to ' + name,
  waitingHelp: 'The files go as soon as it answers. It still asks before it takes them.',
  cancelWaiting: 'Cancel',
  panelTitle: 'Saved devices',
  panelIntro: 'Devices you chose to remember. When both of you have Files Direct open, they show up on the home page.',
  selfLabel: 'Name of this device',
  selfSave: 'Save name',
  selfSaved: (others: boolean) => (others ? 'Name saved. The other device sees the new name the next time you connect.' : 'Name saved.'),
  none: 'No saved devices.',
  forget: 'Forget',
  forgetLabel: (name: string) => 'Forget ' + name,
  forgotten: (name: string) => name + ' is forgotten, here and on that device.',
  forgotUnsure: (name: string) => name + ' is forgotten here. We could not reach our servers, so that device may still list this one.',
  clearing: "Clearing this browser's data forgets its saved devices. Forgetting a device here also forgets this one there.",
  dropped: (name: string) => name + ' forgot this device, so it is no longer saved here.',
  close: 'Close',
  menu: 'Saved devices',
} as const;
