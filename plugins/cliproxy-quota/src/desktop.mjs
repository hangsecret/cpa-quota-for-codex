import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const cursors = new Map();

function readViewEvents(file, size) {
  let cursor = cursors.get(file);
  if (!cursor || size < cursor.offset) {
    cursor = { offset: 0, pending: '', selection: undefined };
    cursors.set(file, cursor);
  }
  if (size === cursor.offset) return cursor.selection;
  const descriptor = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(65536);
    while (cursor.offset < size) {
      const count = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, size - cursor.offset), cursor.offset);
      if (!count) break;
      cursor.offset += count;
      const lines = (cursor.pending + buffer.toString('utf8', 0, count)).split('\n');
      cursor.pending = lines.pop();
      for (const line of lines) {
        const event = line.match(/^[\dT:.Z-]+ .*\[host-app-server-manager\] thread_stream_view_activity_changed active=(true|false) conversationId=([a-zA-Z0-9-]+) /);
        if (!event) continue;
        const [, active, threadId] = event;
        if (active === 'true') cursor.selection = { threadId };
        else if (cursor.selection?.threadId === threadId) cursor.selection = { threadId: null };
      }
    }
  } finally { fs.closeSync(descriptor); }
  return cursor.selection;
}

function desktopLogFiles() {
  const root = process.env.CLIPROXY_CODEX_LOGS || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Codex', 'Logs');
  return fs.readdirSync(root, { recursive: true })
      .filter(name => /codex-desktop-.*-t0-.*\.log$/.test(name))
      .map(name => {
        const file = path.join(root, name);
        const stats = fs.statSync(file);
        const session = path.basename(file).match(/^codex-desktop-(.+)-\d+-t0-/)?.[1];
        return { file, size: stats.size, mtimeMs: stats.mtimeMs, session };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export function desktopSession() {
  try { return desktopLogFiles()[0]?.session || null; }
  catch { return null; }
}

// Activity timestamps change on message submission. View events also change on navigation.
export function desktopThread() {
  try {
    const files = desktopLogFiles();
    for (const { file, size, session } of files) {
      if (session !== files[0].session) continue;
      const selection = readViewEvents(file, size);
      if (selection) return selection;
    }
  } catch { /* Logs may be unavailable after an application update. */ }
  return undefined;
}
