/** The words of the Files Direct window about saved devices (files-direct-40). The site's own sentences (web/src/saved-copy.ts) are used where they fit; where the app is not a page they are these. */
/** The words of the window about saved devices. The site's sentences are used where they fit; where the app is not a page they are its own. */
export const APP_SAVED = {
  saved: (name: string): string => name + ' is remembered. While Files Direct is running on this computer, ' + name + ' can send files here with no link or code. You still say yes before anything is saved. To forget it, open the Files Direct window with nothing in it.',
  invited: (name: string): string => name + ' wants to send you files',
  connecting: (name: string): string => 'Connecting with ' + name + '…',
  offer: (name: string, files: string, total: string): string => name + ' wants to send you ' + files + ' (' + total + ')',
  offerSub: 'Nothing is saved until you say yes.',
  accept: 'Accept',
  noThanks: 'No thanks',
  panelTitle: 'Saved devices',
  panelHelp: 'Devices you chose to remember. They can send to this computer while Files Direct is running.',
  forget: 'Forget',
  forgetLabel: (name: string): string => 'Forget ' + name,
} as const;
