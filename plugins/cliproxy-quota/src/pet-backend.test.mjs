import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

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
    const diagnostic = (await call('test_management_connection')).result;
    assert.equal(diagnostic.connected, false);
    assert.equal(diagnostic.endpoint, '');
    const refreshed = (await call('pet_refresh', { model: 'devin/claude-opus-5-5' })).result;
    assert.match(refreshed.error, /管理密钥/);
    assert.equal(refreshed.retryable, false);
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

test('quota bridge keeps stale data during transient failures and clears errors after recovery', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-recovery-'));
  let mode = 'ok';
  const server = http.createServer((request, response) => {
    if (mode === 'offline') { request.socket.destroy(); return; }
    response.setHeader('Content-Type', 'application/json');
    if (mode === 'unauthorized') { response.writeHead(401); response.end('{}'); return; }
    const value = request.url.endsWith('/credentials') ? { files: [{ name: 'demo', provider: 'codex', auth_index: '1' }] }
      : request.url.includes('/credentials/models') ? { models: [{ id: 'gpt-test' }] }
      : request.url.endsWith('/plugins') ? { plugins: [] }
      : { status_code: 200, body: { rate_limit: { primary_window: { used_percent: 25 } } } };
    response.end(JSON.stringify(value));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ baseUrl: `http://127.0.0.1:${server.address().port}`, apiVersion: 'v8' }));
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(new URL('pet-backend.mjs', import.meta.url))], {
    env: { ...process.env, CLIPROXY_QUOTA_DATA: directory, CLIPROXY_MANAGEMENT_KEY: 'test-key', CLIPROXY_DISABLE_DESKTOP_AUTOSTART: '1' },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  const lines = readline.createInterface({ input: child.stdout });
  let id = 0;
  function refresh() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Recovery test timed out')), 5000);
      lines.once('line', line => { clearTimeout(timer); resolve(JSON.parse(line).result); });
      child.stdin.write(JSON.stringify({ id: ++id, method: 'pet_refresh', args: { refresh: true, model: 'gpt-test' } }) + '\n');
    });
  }
  try {
    const initial = await refresh();
    assert.equal(initial.error, null);
    assert.equal(initial.matching[0].windows[0].remainingPercent, 75);
    mode = 'offline';
    const failed = await refresh();
    assert.equal(failed.retryable, true);
    assert(failed.error);
    assert.equal(failed.fetchedAt, initial.fetchedAt);
    assert.equal(failed.matching[0].windows[0].remainingPercent, 75);
    mode = 'unauthorized';
    const blocked = await refresh();
    assert.equal(blocked.retryable, false);
    assert.match(blocked.error, /管理密钥/);
    mode = 'ok';
    const recovered = await refresh();
    assert.equal(recovered.error, null);
    assert.equal(recovered.retryable, false);
    assert.equal(recovered.matching[0].windows[0].remainingPercent, 75);
  } finally {
    child.stdin.end(); child.kill(); lines.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
