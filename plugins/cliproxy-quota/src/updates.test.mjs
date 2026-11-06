import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { compareVersions, releaseInfo, createUpdater } from './updates.mjs';

const archive = Buffer.from('verified test package');
const release = {
  version: '2.9.0', notes: '更新说明', sha256: createHash('sha256').update(archive).digest('hex'),
  downloadUrl: 'https://github.com/hangsecret/cpa-quota-for-codex/releases/download/v2.9.0/cpa-quota-for-codex-2.9.0-windows.zip',
};

function directory(t) {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-update-'));
  t.after(() => fs.rmSync(value, { recursive: true, force: true }));
  return value;
}

test('release versions compare numerically and update URLs stay in the project release', () => {
  assert.equal(compareVersions('2.10.0', '2.9.9'), 1);
  assert.equal(compareVersions('2.8.0', '2.8.0'), 0);
  assert.equal(compareVersions('2.7.1', '2.8.0'), -1);
  assert.throws(() => compareVersions('2.8.0-beta', '2.8.0'), /版本/);
  assert.throws(() => releaseInfo({ ...release, downloadUrl: 'https://example.com/update.zip' }), /地址/);
  assert.throws(() => releaseInfo({ ...release, sha256: 'invalid' }), /校验/);
});

test('update checks are cached for a day across restarts and manual checks refresh', async t => {
  const data = directory(t);
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert(url.endsWith('/releases/latest/download/update.json'));
    assert.equal(options.headers, undefined);
    return Response.json(release);
  };
  const updater = createUpdater({ directory: data, version: '2.8.0', fetcher });
  const state = await updater.check();
  assert.equal(state.available, true);
  assert.equal(state.notes, '更新说明');
  assert.equal((await updater.check()).latestVersion, '2.9.0');
  await createUpdater({ directory: data, version: '2.8.0', fetcher }).check();
  assert.equal(calls, 1);
  await updater.check(true);
  assert.equal(calls, 2);
  const cached = JSON.parse(fs.readFileSync(path.join(data, 'update-check.json')));
  cached.checkedAt = new Date(Date.now() - 25 * 3600000).toISOString();
  fs.writeFileSync(path.join(data, 'update-check.json'), JSON.stringify(cached));
  await updater.check();
  assert.equal(calls, 3);
});

test('failed automatic checks are throttled and preserve the last valid release', async t => {
  const data = directory(t);
  let offline = false;
  let calls = 0;
  const updater = createUpdater({ directory: data, version: '2.8.0', fetcher: async () => {
    calls++;
    if (offline) throw new Error('untrusted network error');
    return Response.json(release);
  } });
  await updater.check();
  offline = true;
  const state = await updater.check(true);
  assert.match(state.error, /GitHub/);
  assert.equal(state.latestVersion, '2.9.0');
  await updater.check();
  assert.equal(calls, 2);
  await assert.rejects(updater.install('2.9.0'), /成功检查/);
});

test('installation verifies SHA256, deduplicates clicks, and persists restart status', async t => {
  const data = directory(t);
  let installs = 0;
  const options = { directory: data, version: '2.8.0', fetcher: async url => url.endsWith('.json') ? Response.json(release) : new Response(archive),
    applyPackage: async (file, destination, version) => {
      installs++;
      assert.deepEqual(fs.readFileSync(file), archive);
      assert.equal(version, '2.9.0');
      assert(destination.startsWith(data));
      await new Promise(resolve => setTimeout(resolve, 20));
    } };
  const updater = createUpdater(options);
  const [first, second] = await Promise.all([updater.install('2.9.0'), updater.install('2.9.0')]);
  assert.equal(installs, 1);
  assert.equal(first.restartRequired, true);
  assert.equal(second.installedVersion, '2.9.0');
  assert.equal((await createUpdater(options).check()).restartRequired, true);
  assert.equal((await createUpdater({ ...options, version: '2.9.0' }).check()).restartRequired, false);
  assert.deepEqual(fs.readdirSync(path.join(data, 'updates')), []);
});

test('corrupt downloads and failed installers leave no successful update marker and allow retry', async t => {
  const data = directory(t);
  let corrupt = true;
  let brokenInstaller = false;
  let installs = 0;
  const updater = createUpdater({ directory: data, version: '2.8.0', fetcher: async url => url.endsWith('.json') ? Response.json(release) : new Response(corrupt ? 'damaged' : archive),
    applyPackage: async () => { installs++; if (brokenInstaller) throw new Error('Installation failed'); } });
  await assert.rejects(updater.install('2.9.0'), /SHA256/);
  assert.equal(installs, 0);
  assert(!fs.existsSync(path.join(data, 'installed-update.json')));
  corrupt = false; brokenInstaller = true;
  await assert.rejects(updater.install('2.9.0'), /Installation failed/);
  assert(!fs.existsSync(path.join(data, 'installed-update.json')));
  brokenInstaller = false;
  assert.equal((await updater.install('2.9.0')).restartRequired, true);
});

test('obsolete selections, older versions and malformed local state are handled', async t => {
  const data = directory(t);
  fs.writeFileSync(path.join(data, 'installed-update.json'), '{"version":"damaged"}');
  fs.writeFileSync(path.join(data, 'update-check.json'), '{"checkedAt":"invalid"}');
  const options = { directory: data, version: '2.8.0', fetcher: async () => Response.json(release) };
  const updater = createUpdater(options);
  assert.equal((await updater.check()).restartRequired, false);
  await assert.rejects(updater.install('2.8.1'), /变化/);
  assert.equal((await createUpdater({ ...options, version: '3.0.0' }).check()).available, false);
});

test('oversized metadata and HTTP errors return a retryable check error', async t => {
  const data = directory(t);
  const updater = createUpdater({ directory: data, fetcher: async () => new Response('x'.repeat(65537)) });
  assert.match((await updater.check()).error, /检查更新/);
  const failed = createUpdater({ directory: data, fetcher: async () => new Response('', { status: 404 }) });
  assert.match((await failed.check(true)).error, /检查更新/);
});
