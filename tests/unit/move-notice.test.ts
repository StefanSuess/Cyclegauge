import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOVE_NOTICE_INSTALL, MOVE_NOTICE_LATER, MOVE_NOTICE_TEXT, showMoveNotice, type MoveNoticeHost } from '../../src/extension/move-notice.ts';

function host(seen: boolean, choice?: string) {
 const calls: string[] = [];
 const h: MoveNoticeHost = {
  seen: () => seen,
  markSeen: () => { calls.push('mark'); },
  show: async (message, ...buttons) => { calls.push(`show:${message}|${buttons.join(',')}`); return choice; },
  openBobert: () => { calls.push('open'); }
 };
 return { h, calls };
}

test('the notice is shown once, marked before it is shown, and offers Install Bobert and Later', async () => {
 const { h, calls } = host(false, MOVE_NOTICE_LATER);
 await showMoveNotice(h);
 assert.deepEqual(calls, ['mark', `show:${MOVE_NOTICE_TEXT}|${MOVE_NOTICE_INSTALL},${MOVE_NOTICE_LATER}`]);
});

test('Install Bobert opens Bobert; dismissing does nothing more', async () => {
 const install = host(false, MOVE_NOTICE_INSTALL); await showMoveNotice(install.h);
 assert.equal(install.calls.at(-1), 'open');
 const dismiss = host(false, undefined); await showMoveNotice(dismiss.h);
 assert.ok(!dismiss.calls.includes('open'));
});

test('an already seen notice is not shown again', async () => {
 const { h, calls } = host(true, MOVE_NOTICE_INSTALL);
 await showMoveNotice(h);
 assert.deepEqual(calls, []);
});

test('the notice text names Bobert, says it is the last update and that nothing is carried over', () => {
 assert.match(MOVE_NOTICE_TEXT, /now Bobert/);
 assert.match(MOVE_NOTICE_TEXT, /last one/);
 assert.match(MOVE_NOTICE_TEXT, /not carried over/);
});
