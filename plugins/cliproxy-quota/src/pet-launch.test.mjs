import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { desktopAutoStartEnabled, startupHandled, processAlive } from './pet-launch.mjs';

test('desktop auto-start respects saved preferences and existing settings defaults', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-autostart-'));
  const env = { LOCALAPPDATA: directory };
  const data = path.join(directory, 'CodexCLIProxyQuota');
  const file = path.join(data, 'desktop-preferences.json');
  try {
    assert.equal(desktopAutoStartEnabled(env), process.platform === 'win32');
    fs.mkdirSync(data);
    fs.writeFileSync(file, '{"Theme":"light"}');
    assert.equal(desktopAutoStartEnabled(env), process.platform === 'win32');
    fs.writeFileSync(file, '{"AutoStart":false}');
    assert.equal(desktopAutoStartEnabled(env), false);
    fs.writeFileSync(file, '{"AutoStart":true}');
    assert.equal(desktopAutoStartEnabled({ ...env, CLIPROXY_DISABLE_DESKTOP_AUTOSTART: '1' }), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('startup only suppresses a live window or an intentional exit in the same session', () => {
  assert.equal(startupHandled({ session: 'app-a' }, null, 'app-a', () => false), false);
  assert.equal(startupHandled({ session: 'app-a', pid: 123 }, { pid: 123, closedByUser: false }, 'app-a', () => false), false);
  assert.equal(startupHandled({ session: 'app-a', pid: 123 }, { pid: 123, closedByUser: false }, 'app-a', () => true), true);
  assert.equal(startupHandled({ session: 'app-a', pid: 123 }, { pid: 123, closedByUser: true }, 'app-a', () => false), true);
  assert.equal(startupHandled({ session: 'app-a', pid: 123 }, { pid: 123, closedByUser: true }, 'app-b', () => false), false);
  assert.equal(processAlive(process.pid), true);
  assert.equal(processAlive(undefined), false);
});
