import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('plugin has a global desktop launcher and no thread panel entrypoint', async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('server.mjs', import.meta.url))], { env: { ...process.env, CLIPROXY_DISABLE_DESKTOP_AUTOSTART: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const lines = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  let id = 0;
  lines.on('line', line => { const value = JSON.parse(line); pending.get(value.id)?.(value.result); });
  function call(method, params = {}) {
    const next = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('MCP timeout')), 5000);
      pending.set(next, result => { clearTimeout(timer); pending.delete(next); resolve(result); });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n');
    });
  }
  try {
    const initialized = await call('initialize', { protocolVersion: '2025-11-25' });
    assert(initialized.capabilities.resources);
    const { tools } = await call('tools/list');
    const entry = tools.find(t => t.name === 'open_quota_console');
    assert.deepEqual(entry._meta['openai/ui'].entrypoints, [{ type: 'global' }]);
    assert(!tools.some(tool => tool._meta?.['openai/ui']?.entrypoints?.some(point => point.type === 'thread')));
    assert.equal(initialized.serverInfo.icons[0].mimeType, 'image/png');
    assert(!tools.some(t => t.name === 'open_quota_file'));
    assert.deepEqual(tools.find(t => t.name === 'update_model')._meta.ui.visibility, ['app']);
    const { contents } = await call('resources/read', { uri: entry._meta.ui.resourceUri });
    assert.equal(contents[0].mimeType, 'text/html;profile=mcp-app');
    assert(contents[0].text.includes('ui/initialize'));
    assert(contents[0].text.includes('open_desktop_panel'));
    assert(!contents[0].text.includes('modelFocus'));
    assert(!contents[0].text.includes('管理密钥'));
    assert(!contents[0].text.includes('src="/app.js"'));
    assert(!contents[0].text.includes('fetch('));
    assert.equal((await call('tools/call', { name: 'get_console_settings' })).isError, undefined);
    assert.equal((await call('tools/call', { name: 'open_quota_console' })).structuredContent.launcher, true);
  } finally { child.stdin.end(); child.kill(); lines.close(); }
});

test('a discovery process exits cleanly with desktop auto-start disabled', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-discovery-'));
  const env = { ...process.env, LOCALAPPDATA: directory, CLIPROXY_DISABLE_DESKTOP_AUTOSTART: '1' };
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(new URL('server.mjs', import.meta.url))], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const lines = readline.createInterface({ input: child.stdout });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('Discovery process failed to close')); }, 2500);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Discovery exited unexpectedly')); });
      lines.once('line', () => child.stdin.end());
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }) + '\n');
    });
    assert.equal(fs.existsSync(path.join(directory, 'CodexCLIProxyQuota', 'desktop-launches')), false);
  } finally { child.kill(); lines.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
