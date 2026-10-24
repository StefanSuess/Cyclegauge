// One-time notice that Cyclegauge is now Bobert. Reads no data; the only saved state is one flag.
export const MOVE_NOTICE_KEY = 'cyclegauge.moveNotice.v1';
export const MOVE_NOTICE_TEXT = 'Cyclegauge is now Bobert. This update is the last one, and Bobert is a new extension: settings and history are not carried over. After you install Bobert, uninstall Cyclegauge so the status bar shows one credit item.';
export const MOVE_NOTICE_INSTALL = 'Install Bobert';
export const MOVE_NOTICE_LATER = 'Later';

export interface MoveNoticeHost {
 seen(): boolean;
 markSeen(): PromiseLike<unknown> | unknown;
 show(message: string, ...buttons: string[]): PromiseLike<string | undefined>;
 openBobert(): PromiseLike<unknown> | unknown;
}

export async function showMoveNotice(host: MoveNoticeHost): Promise<void> {
 if (host.seen()) return;
 await host.markSeen(); // before showing: it appears once, even if the window closes meanwhile
 const choice = await host.show(MOVE_NOTICE_TEXT, MOVE_NOTICE_INSTALL, MOVE_NOTICE_LATER);
 if (choice === MOVE_NOTICE_INSTALL) await host.openBobert();
}
