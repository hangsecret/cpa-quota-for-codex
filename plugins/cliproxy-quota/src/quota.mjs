import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const dataDir = process.env.CLIPROXY_QUOTA_DATA || path.join(process.env.LOCALAPPDATA || os.homedir(), 'CodexCLIProxyQuota');
const settingsFile = path.join(dataDir, 'settings.json');

export function protect(value, decrypt = false) {
  if (process.platform !== 'win32') throw new Error('此版本的密钥存储需要 Windows DPAPI。');
  const script = decrypt
    ? '$v=[Console]::In.ReadToEnd(); $s=ConvertTo-SecureString $v; $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try {[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}'
    : '$v=[Console]::In.ReadToEnd(); $s=ConvertTo-SecureString $v -AsPlainText -Force; [Console]::Write((ConvertFrom-SecureString $s))';
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const modulePath = path.join(path.dirname(powershell), 'Modules');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; " + script], { input: value, encoding: 'utf8', windowsHide: true, timeout: 10000, env: { ...process.env, PSModulePath: modulePath } });
  if (result.status !== 0) throw new Error('Windows 密钥加解密失败。');
  return result.stdout.trim();
}

export function settings() {
  if (!fs.existsSync(settingsFile)) return { baseUrl: '', apiVersion: 'v8', encryptedKey: '' };
  return JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
}

export function saveSettings(input) {
  const previous = settings();
  const url = new URL(input.baseUrl);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('请输入后台站点根地址。');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('远程后台必须使用 HTTPS。');
  if (!['v8', 'v0'].includes(input.apiVersion)) throw new Error('管理 API 版本无效。');
  const baseUrl = url.origin;
  if (baseUrl !== previous.baseUrl && !input.managementKey) throw new Error('更换站点时请重新输入对应的管理密钥。');
  const encryptedKey = input.managementKey ? protect(input.managementKey) : previous.encryptedKey;
  if (!encryptedKey) throw new Error('请填写 CLIProxy 管理密钥。');
  fs.mkdirSync(dataDir, { recursive: true });
  const temporary = settingsFile + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify({ baseUrl, apiVersion: input.apiVersion, encryptedKey }, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, settingsFile);
  cached = undefined;
}

class ApiError extends Error {
  constructor(status, reason) {
    super(reason || (status === 401 ? '管理认证失败，请检查管理密钥（HTTP 401）。'
      : status === 403 ? '管理接口拒绝访问，请检查远程管理与 IP 访问限制（HTTP 403）。' : `管理接口返回 HTTP ${status}`));
    this.status = status;
  }
}

function networkError(error) {
  const reasons = {
    ENOTFOUND: 'DNS 无法解析管理站点域名', EAI_AGAIN: 'DNS 查询暂时失败',
    ECONNREFUSED: '管理站点拒绝连接，请检查端口与服务状态',
    ECONNRESET: '管理连接被重置，请检查网络、代理或防火墙',
    UND_ERR_SOCKET: '管理连接被提前关闭，请检查网络、代理或防火墙',
    ETIMEDOUT: '连接管理接口超时', UND_ERR_CONNECT_TIMEOUT: '连接管理接口超时',
    UND_ERR_HEADERS_TIMEOUT: '等待管理接口响应超时', UND_ERR_BODY_TIMEOUT: '读取管理接口响应超时',
    CERT_HAS_EXPIRED: '管理站点的 HTTPS 证书已过期',
    ERR_TLS_CERT_ALTNAME_INVALID: '管理站点的 HTTPS 证书与域名不匹配',
    DEPTH_ZERO_SELF_SIGNED_CERT: '管理站点使用了未受信任的自签名证书',
    SELF_SIGNED_CERT_IN_CHAIN: '管理站点的证书链包含未受信任的自签名证书',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: '无法验证管理站点的 HTTPS 证书链',
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: '无法找到管理站点证书的受信任签发机构',
    ERR_SSL_WRONG_VERSION_NUMBER: '管理站点 HTTPS 握手失败，请检查代理与端口配置',
  };
  const candidates = [error, error?.cause, ...(error?.cause?.errors || [])];
  const matched = candidates.find(item => reasons[item?.code]);
  let code = matched?.code;
  let message = reasons[code];
  if (!message && ['TimeoutError', 'AbortError'].includes(error?.name)) {
    code = 'TIMEOUT'; message = '管理接口请求超过 20 秒，请检查网络或服务响应';
  }
  if (!message && candidates.some(item => item?.message === 'unexpected redirect')) {
    code = 'REDIRECT'; message = '管理接口发生重定向，请保存最终 HTTPS 管理站点地址';
  }
  const result = new Error(message ? `${message}（${code}）。` : '无法连接管理接口，请检查网络、代理及 HTTPS 证书。');
  result.code = code || 'NETWORK_ERROR';
  return result;
}

export async function request(baseUrl, key, route, body, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(baseUrl + route, { method: body ? 'POST' : 'GET', redirect: 'error', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  } catch (error) { throw networkError(error); }
  if (!response.ok) {
    let reason;
    if (response.status === 403) {
      try {
        const payload = await response.json();
        if (payload.error === 'remote management disabled') reason = 'CPA 已限制远程管理访问，请由管理员检查 management.allow-remote（HTTP 403）。';
        if (typeof payload.error === 'string' && payload.error.startsWith('IP banned due to too many failed attempts.')) reason = '当前 IP 因连续管理认证失败被临时封禁，请稍后重试（HTTP 403）。';
      } catch { /* An HTML gateway rejection still carries the HTTP status. */ }
    }
    throw new ApiError(response.status, reason);
  }
  try { return await response.json(); }
  catch (error) {
    if (error instanceof SyntaxError) throw new Error('管理接口未返回 JSON，请检查地址和 API 版本。');
    throw networkError(error);
  }
}

function managementKey(config) {
  const key = process.env.CLIPROXY_MANAGEMENT_KEY || (config.encryptedKey ? protect(config.encryptedKey, true) : '');
  if (!key) throw new Error('请先打开额度面板，在设置中填写 CLIProxy 管理密钥。');
  return key;
}

export async function testManagementConnection(config = settings(), key, fetcher = fetch) {
  const started = Date.now();
  let endpoint = '';
  try {
    let base;
    try {
      base = new URL(config.baseUrl);
      if (base.username || base.password || base.search || base.hash || base.pathname !== '/' || !['v8', 'v0'].includes(config.apiVersion)) throw new Error();
      if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) throw new Error();
    } catch { throw new Error('请先保存有效的管理后台根地址和 API 版本。'); }
    const route = config.apiVersion === 'v8' ? '/credentials' : '/auth-files';
    const root = `${base.origin}/${config.apiVersion}/management`;
    endpoint = root + route;
    const response = await request(root, key ?? managementKey(config), route, undefined, fetcher);
    if (!Array.isArray(response?.files)) throw new Error('管理接口返回的凭据列表格式不匹配，请检查站点和 API 版本。');
    return { connected: true, endpoint, elapsedMs: Date.now() - started, message: '管理接口连接与认证成功。', runtime: process.version };
  } catch (error) {
    return { connected: false, endpoint, elapsedMs: Date.now() - started, error: error.message, code: error.code || null, status: error.status || null, runtime: process.version };
  }
}

const number = value => typeof value === 'number' && Number.isFinite(value);
const clamp = value => Math.max(0, Math.min(100, value));
function windowRow(label, used, reset) {
  return { label, remainingPercent: clamp(100 - used), resetAt: reset || null };
}

export function normalizeQuota(payload, provider) {
  const rows = [];
  for (const group of payload.groups || []) {
    for (const bucket of group.buckets || []) {
      const fraction = bucket.remainingFraction ?? bucket.remaining_fraction;
      if (number(fraction)) rows.push({ label: [group.displayName || group.display_name, bucket.displayName || bucket.display_name || bucket.window].filter(Boolean).join(' · '), remainingPercent: clamp(fraction * 100), resetAt: bucket.resetTime || bucket.reset_time || null });
    }
  }
  if (provider === 'codex') {
    for (const [name, limit] of [['主配额', payload.rate_limit], ['代码审查', payload.code_review_rate_limit]]) {
      for (const [label, window] of [['短周期', limit?.primary_window], ['长周期', limit?.secondary_window]]) {
        if (number(window?.used_percent)) rows.push(windowRow(`${name} · ${label}`, window.used_percent, window.reset_at ? new Date(window.reset_at * 1000).toISOString() : null));
      }
    }
  }
  if (provider === 'claude') {
    for (const [key, value] of Object.entries(payload)) {
      if (number(value?.utilization)) rows.push(windowRow(key.replaceAll('_', ' '), value.utilization, value.resets_at));
    }
  }
  if (provider === 'devin') {
    const plan = payload.userStatus?.planStatus;
    for (const [key, label] of [['daily', '每日额度'], ['weekly', '每周额度']]) {
      const remaining = plan?.[`${key}QuotaRemainingPercent`];
      const value = typeof remaining === 'string' && remaining.trim() ? Number(remaining) : remaining;
      const reset = Number(plan?.[`${key}QuotaResetAtUnix`]);
      if (number(value)) rows.push({ label, remainingPercent: clamp(value), resetAt: reset > 0 && Number.isFinite(reset) ? new Date(reset * 1000).toISOString() : null });
    }
  }
  for (const bucket of payload.buckets || []) {
    if (number(bucket.remainingFraction)) rows.push({ label: bucket.modelId || 'Gemini', remainingPercent: clamp(bucket.remainingFraction * 100), resetAt: bucket.resetTime || null });
  }
  return rows;
}

async function accountQuota(account, plugins, call, version) {
  const provider = String(account.provider || account.type || '').toLowerCase();
  const index = account.auth_index ?? account.authIndex;
  const result = { name: account.name || '未命名账户', provider, disabled: account.disabled === true || account.disabled === 'true', windows: [], models: account.supportedModels || [], modelDiscovery: account.modelDiscovery || 'unknown', supplier: account.supplier || provider };
  if (result.disabled) return { ...result, status: 'disabled' };
  if (index === undefined || index === null || index === '') return { ...result, status: 'unsupported', error: '账户缺少 auth_index。' };
  try {
    let payload;
    const plugin = account.quota_plugin_id || plugins.find(p => p.supports_quota && p.enabled !== false && p.effective_enabled !== false && (p.quota_provider || p.oauth_provider || p.id) === (account.quota_provider || provider))?.id;
    if (plugin) {
      payload = await call(`/plugins/${encodeURIComponent(plugin)}/quota?auth_index=${encodeURIComponent(index)}`);
    } else {
      let url;
      const header = { Authorization: 'Bearer $TOKEN$', 'Content-Type': 'application/json' };
      let method = 'GET';
      let data;
      if (provider === 'codex') {
        url = 'https://chatgpt.com/backend-api/wham/usage';
        header['User-Agent'] = 'codex-tui/0.166.0';
        const accountId = account.id_token?.chatgpt_account_id || account.chatgpt_account_id;
        if (accountId) header['Chatgpt-Account-Id'] = accountId;
      } else if (provider === 'claude') {
        url = 'https://api.anthropic.com/api/oauth/usage';
        header['anthropic-beta'] = 'oauth-2025-04-20';
        header['User-Agent'] = 'claude-cli/2.1.280 (external, cli)';
      } else if (provider === 'gemini' || provider === 'antigravity') {
        const project = account.project_id || account.projectId;
        if (!project) throw new Error('账户缺少 project_id，需由服务端配额插件提供查询。');
        url = provider === 'antigravity' ? 'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary' : 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota';
        method = 'POST';
        data = JSON.stringify({ project });
        if (provider === 'antigravity') header['User-Agent'] = 'antigravity/hub/2.23.0 darwin/arm64';
      } else if (provider === 'devin') {
        url = 'https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus';
        method = 'POST';
        delete header.Authorization;
        header['Connect-Protocol-Version'] = '1';
        data = JSON.stringify({ metadata: { ideName: 'chisel', ideVersion: '3000.10.21', apiKey: '$TOKEN$', locale: 'en', os: 'darwin', extensionVersion: '3000.10.21', clientName: 'chisel' } });
      } else return { ...result, status: 'unsupported', error: '该渠道需要 CLIProxy 服务端启用配额插件。' };
      const response = await call(version === 'v8' ? '/requests/api-call' : '/api-call', { auth_index: String(index), method, url, header, ...(data ? { data } : {}) });
      if (response.status_code !== 200) throw new Error(`上游配额查询返回 HTTP ${response.status_code || '未知'}`);
      payload = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
    }
    result.windows = normalizeQuota(payload || {}, provider);
    return { ...result, status: result.windows.length ? 'ok' : 'empty', ...(!result.windows.length ? { error: '上游未返回可识别的剩余配额。' } : {}) };
  } catch (error) {
    if (error.status === 401 || error.status === 403) throw error;
    return { ...result, status: 'error', error: error instanceof SyntaxError ? '上游配额响应格式错误。' : error.message };
  }
}

export async function collectQuota(config, key, fetcher = fetch) {
  const base = `${config.baseUrl}/${config.apiVersion}/management`;
  const call = (route, body) => request(base, key, route, body, fetcher);
  const credentials = await call(config.apiVersion === 'v8' ? '/credentials' : '/auth-files');
  if (!Array.isArray(credentials.files)) throw new Error('凭据列表格式不受支持。');
  let plugins = [];
  if (config.apiVersion === 'v8') {
    try { plugins = (await call('/plugins')).plugins || []; } catch (error) { if (error.status !== 404) throw error; }
  }
  const accounts = [];
  // Sequential reads stop immediately on management authentication failures.
  for (const account of credentials.files) {
    let supportedModels = [];
    let modelDiscovery = 'unknown';
    if (account.name) {
      try {
        const response = await call(`${config.apiVersion === 'v8' ? '/credentials/models' : '/auth-files/models'}?name=${encodeURIComponent(account.name)}`);
        if (Array.isArray(response.models)) {
          supportedModels = [...new Set(response.models.map(m => typeof m === 'string' ? m : m.id).filter(m => typeof m === 'string' && m))];
          modelDiscovery = 'confirmed';
        }
      } catch (error) { if (error.status === 401 || error.status === 403) throw error; }
    }
    const namespaces = [...new Set(supportedModels.filter(m => m.includes('/')).map(m => m.split('/')[0]))];
    const provider = String(account.provider || account.type || '').toLowerCase();
    const supplier = namespaces.length === 1 ? namespaces[0] : typeof account.label === 'string' && account.label.trim() ? account.label.trim() : provider;
    accounts.push(await accountQuota({ ...account, supportedModels, modelDiscovery, supplier }, plugins, call, config.apiVersion));
  }
  return { baseUrl: config.baseUrl, fetchedAt: new Date().toISOString(), accounts };
}

let pending;
let cached;
export async function queryQuota(force = false) {
  if (!force && cached && Date.now() - cached.time < 60000) return cached.value;
  if (pending) return pending;
  pending = (async () => {
    const config = settings();
    const key = managementKey(config);
    const value = await collectQuota(config, key);
    cached = { time: Date.now(), value };
    return value;
  })();
  try { return await pending; } finally { pending = null; }
}
