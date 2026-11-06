import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('desktop bridge isolates its commands and reports unavailable quotas without exposing settings keys', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-pet-'));
  const env = { ...process.env, CLIPROXY_QUOTA_DATA: directory };
  delete env.CLIPROXY_MANAGEMENT_KEY;
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(new URL('pet-backend.mjs', import.meta.url))], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const lines = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  let sequence = 0;
  lines.on('line', line => { const reply = JSON.parse(line); pending.get(reply.id)?.(reply); });
  function call(method, args = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('desktop bridge timeout')), 5000);
      pending.set(id, reply => { clearTimeout(timeout); pending.delete(id); resolve(reply); });
      child.stdin.write(JSON.stringify({ id, method, args }) + '\n');
    });
  }
  try {
    const settings = (await call('get_console_settings')).result;
    assert.equal(settings.configured, false);
    assert.equal(settings.encryptedKey, undefined);
    const refreshed = (await call('pet_refresh', { model: 'devin/claude-opus-5-5' })).result;
    assert.match(refreshed.error, /管理密钥/);
    assert.equal(refreshed.focus.id, 'devin/claude-opus-5-5');
    const state = (await call('pet_state', { model: 'gemini-3.8-flash-high' })).result;
    assert.equal(state.focus.id, 'gemini-3.8-flash-high');
    assert.deepEqual(state.matching, []);
    assert.match((await call('open_desktop_panel')).error, /未知/);
  } finally {
    child.stdin.end(); child.kill(); lines.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
