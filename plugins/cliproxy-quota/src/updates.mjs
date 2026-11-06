import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dataDir } from './quota.mjs';
import { currentVersion } from './version.mjs';

const repository = 'https://github.com/hangsecret/cpa-quota-for-codex';
const day = 24 * 60 * 60 * 1000;

export function compareVersions(left, right) {
  const valid = value => typeof value === 'string' && /^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value);
  if (!valid(left) || !valid(right)) throw new Error('版本号格式无效。');
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return Math.sign(a[index] - b[index]);
  }
  return 0;
}

export function releaseInfo(value) {
  compareVersions(value?.version, '0.0.0');
  if (!/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error('更新校验信息无效。');
  const base = `${repository}/releases/download/v${value.version}`;
  const downloadUrl = `${base}/cpa-quota-for-codex-${value.version}-windows.zip`;
  if (value.downloadUrl !== downloadUrl) throw new Error('更新下载地址无效。');
  return { version: value.version, sha256: value.sha256, downloadUrl, notes: String(value.notes || '').slice(0, 12000), releaseUrl: `${repository}/releases/tag/v${value.version}` };
}

async function readResponse(response, limit) {
  if (!response.ok) throw new Error(`GitHub 返回 HTTP ${response.status}，请稍后重试。`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('更新文件超过大小限制。');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value));
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}

async function installPackage(archive, directory, version) {
  const script = fileURLToPath(new URL('../scripts/apply-update.ps1', import.meta.url));
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const output = fs.openSync(path.join(path.dirname(directory), 'install.log'), 'w');
  try {
    const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-Archive', archive, '-Destination', directory, '-ExpectedVersion', version], { windowsHide: true, stdio: ['ignore', output, output] });
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error('Installer exited unsuccessfully')));
    });
  } catch {
    throw new Error('安装更新失败，当前版本可继续使用。可重试或到 GitHub 下载新版安装包。');
  } finally { fs.closeSync(output); }
}

export function createUpdater({ directory = dataDir, version = currentVersion, fetcher = fetch, applyPackage = installPackage } = {}) {
  const cacheFile = path.join(directory, 'update-check.json');
  const installedFile = path.join(directory, 'installed-update.json');
  let checking;
  let installing;

  function view(state) {
    let installed = readJson(installedFile);
    try { if (installed) compareVersions(installed.version, version); } catch { installed = null; }
    const release = state?.release ? releaseInfo(state.release) : null;
    return {
      currentVersion: version, latestVersion: release?.version || null, checkedAt: state?.checkedAt || null,
      notes: release?.notes || '', releaseUrl: release?.releaseUrl || `${repository}/releases`,
      available: !!release && compareVersions(release.version, version) > 0,
      restartRequired: !!installed && compareVersions(installed.version, version) > 0,
      installedVersion: installed?.version || null, error: state?.error || null,
    };
  }

  async function check(force = false) {
    if (checking) return checking;
    const previous = readJson(cacheFile);
    const age = Date.now() - Date.parse(previous?.checkedAt);
    if (!force && age >= 0 && age < day) {
      try { return view(previous); } catch { /* Fetch a valid manifest if the local cache is obsolete. */ }
    }
    checking = (async () => {
      const state = { checkedAt: new Date().toISOString() };
      try {
        const response = await fetcher(`${repository}/releases/latest/download/update.json`, { signal: AbortSignal.timeout(15000) });
        const content = await readResponse(response, 64 * 1024);
        state.release = releaseInfo(JSON.parse(content.toString('utf8')));
      } catch {
        state.error = '无法检查更新，请检查 GitHub 连接后重试。';
        try { if (previous?.release) state.release = releaseInfo(previous.release); } catch { /* Discard invalid cached metadata. */ }
      }
      writeJson(cacheFile, state);
      return view(state);
    })();
    try { return await checking; } finally { checking = null; }
  }

  async function install(expectedVersion) {
    if (installing) return installing;
    installing = (async () => {
      const state = await check(false);
      if (state.error) throw new Error('请先成功检查更新，再重试安装。');
      if (!state.available || state.latestVersion !== expectedVersion) throw new Error('可用版本已变化，请重新检查更新。');
      const release = releaseInfo(readJson(cacheFile).release);
      const staging = path.join(directory, 'updates', randomUUID());
      fs.mkdirSync(staging, { recursive: true });
      try {
        const response = await fetcher(release.downloadUrl, { signal: AbortSignal.timeout(90000) });
        const archive = await readResponse(response, 50 * 1024 * 1024);
        if (createHash('sha256').update(archive).digest('hex') !== release.sha256) throw new Error('安装包 SHA256 校验失败，请重新下载。');
        const archiveFile = path.join(staging, 'update.zip');
        fs.writeFileSync(archiveFile, archive);
        await applyPackage(archiveFile, path.join(staging, 'package'), release.version);
        writeJson(installedFile, { version: release.version, installedAt: new Date().toISOString() });
        return view(readJson(cacheFile));
      } finally { fs.rmSync(staging, { recursive: true, force: true }); }
    })();
    try { return await installing; } finally { installing = null; }
  }

  return { check, install };
}

export const updater = createUpdater();
