import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const plugin = fileURLToPath(new URL('../', import.meta.url));

test('installed MCP launcher works from a different path with spaces and Unicode', { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-package-'));
  const copied = path.join(directory, '插件 with spaces');
  fs.cpSync(plugin, copied, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(copied, '.mcp.json'), 'utf8'));
  const config = manifest.mcpServers.quota;
  assert.equal(config.cwd, '.');
  assert(!JSON.stringify(config).includes('C:/Users/PC'));
  const child = spawn(config.command, config.args, {
    cwd: path.resolve(copied, config.cwd),
    env: { ...process.env, CPA_QUOTA_NODE: process.execPath, CLIPROXY_DISABLE_DESKTOP_AUTOSTART: '1', CLIPROXY_QUOTA_DATA: directory },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  const lines = readline.createInterface({ input: child.stdout });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  try {
    const response = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Launcher timed out. ${errors}`)), 10000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Launcher exited ${code}. ${errors}`)); });
      lines.once('line', line => {
        clearTimeout(timer);
        try { resolve(JSON.parse(line)); } catch (error) { reject(error); }
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }) + '\n');
    });
    assert.equal(response.result.serverInfo.title, '额度与模型');
    assert.equal(response.result.serverInfo.version, JSON.parse(fs.readFileSync(path.join(copied, '.codex-plugin/plugin.json'), 'utf8')).version);
  } finally {
    child.stdin.end();
    lines.close();
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      setTimeout(() => { child.kill(); resolve(); }, 1000).unref();
    });
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
