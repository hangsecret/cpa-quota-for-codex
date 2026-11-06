import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { desktopSession } from './desktop.mjs';

const desktopData = () => path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'CodexCLIProxyQuota');

export function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

export function startupHandled(marker, runtime, session, alive = processAlive) {
  if (!session || marker?.session !== session || !Number.isSafeInteger(marker.pid)) return false;
  return alive(marker.pid) || (runtime?.pid === marker.pid && runtime.closedByUser === true);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

export async function openDesktopPanel({ background = false } = {}) {
  if (process.platform !== 'win32') throw new Error('桌面悬浮面板当前支持 Windows。');
  const executable = fileURLToPath(new URL('pet/QuotaPet.exe', import.meta.url));
  if (!fs.existsSync(executable)) throw new Error('桌面面板尚未编译，请运行插件 pet 目录中的 build.ps1。');
  const script = fileURLToPath(new URL('pet-backend.mjs', import.meta.url));
  const launchId = randomUUID();
  const directory = path.join(desktopData(), 'desktop-launches');
  fs.mkdirSync(directory, { recursive: true });
  const acknowledgment = path.join(directory, launchId + '.json');
  const args = ['--shell-launch', '--node', process.execPath, '--bridge', script, '--ack', acknowledgment, '--launch-id', launchId];
  if (background) args.push('--background-start');
  const child = spawn(executable, args, { detached: true, stdio: 'ignore', windowsHide: false });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(new Error('桌面面板启动失败。'))); });
  child.unref();
  let exitCode;
  child.once('exit', code => { exitCode = code; });
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      const ready = readJson(acknowledgment);
      if (ready?.launchId === launchId && processAlive(ready.pid)) return { opened: true, pid: ready.pid, display: 'desktop-floating', width: 250 };
      if (exitCode !== undefined && exitCode !== 0) throw new Error('桌面窗口在初始化时退出，请重新打开。');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('桌面窗口未完成启动，请重试。');
  } finally { if (fs.existsSync(acknowledgment)) fs.unlinkSync(acknowledgment); }
}

export function desktopAutoStartEnabled(env = process.env) {
  if (process.platform !== 'win32' || env.CLIPROXY_DISABLE_DESKTOP_AUTOSTART === '1') return false;
  const file = path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'CodexCLIProxyQuota', 'desktop-preferences.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8'))?.AutoStart !== false; }
  catch { return true; }
}

export async function autoStartDesktopPanel() {
  if (!desktopAutoStartEnabled()) return;
  const session = desktopSession();
  if (!session) return openDesktopPanel({ background: true });
  const directory = desktopData();
  const file = path.join(directory, 'desktop-startup-session.json');
  const runtime = readJson(path.join(directory, 'desktop-runtime.json'));
  if (startupHandled(readJson(file), runtime, session)) return;
  const started = await openDesktopPanel({ background: true });
  fs.mkdirSync(directory, { recursive: true });
  const temporary = file + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify({ session, pid: started.pid }));
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  return started;
}
