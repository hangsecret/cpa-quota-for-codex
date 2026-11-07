import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { desktopThread } from './desktop.mjs';
import { dataDir, protect } from './quota.mjs';
import { randomUUID } from 'node:crypto';

const codexDir = () => process.env.CLIPROXY_CODEX_HOME || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
function rootString(text, name) {
  const root = text.split(/^\s*\[/m)[0];
  return root.match(new RegExp(`^${name}\\s*=\\s*["']([^"']+)["']`, 'm'))?.[1];
}
function source() {
  const home = codexDir();
  const configPath = path.join(home, 'config.toml');
  const config = fs.readFileSync(configPath, 'utf8');
  const catalogSetting = rootString(config, 'model_catalog_json');
  if (!catalogSetting) throw new Error('Codex 尚未配置本地模型目录。请先配置 model_catalog_json。');
  const catalogPath = path.resolve(home, catalogSetting);
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  if (!Array.isArray(catalog.models)) throw new Error('模型目录格式无效。');
  return { configPath, config, catalogPath, catalog, current: rootString(config, 'model') };
}
function view(state) {
  return { current: state.current || null, restartRequired: true, models: state.catalog.models.filter(m => !['gpt-reserve', 'codex-auto-review'].includes(m.slug)).map(m => ({ id: m.slug, name: m.display_name || m.slug, enabled: m.visibility === 'list', current: state.current === m.slug })) };
}
export function listModels() { return view(source()); }

export function publicModels(rows) {
  if (!Array.isArray(rows)) throw new Error('模型接口未返回可识别的模型列表。');
  const models = new Map();
  for (const row of rows) {
    const id = typeof row === 'string' ? row : row?.id;
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(id)) continue;
    if (['gpt-reserve', 'codex-auto-review'].includes(id.split('/').at(-1))) continue;
    const name = typeof row?.display_name === 'string' ? row.display_name : id;
    if (!models.has(id)) models.set(id, { id, name: name.trim().slice(0, 100) || id });
  }
  return [...models.values()].filter(row => !row.id.includes('/') || !models.has(row.id.slice(row.id.indexOf('/') + 1)))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function modelConnection(directory) {
  const home = codexDir();
  const config = fs.readFileSync(path.join(home, 'config.toml'), 'utf8');
  const providerName = rootString(config, 'model_provider');
  if (!providerName) throw new Error('请先在 Codex 中配置中转站 model_provider。');
  const escaped = providerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const header = config.match(new RegExp(`^\\s*\\[model_providers\\.(?:${escaped}|"${escaped}"|'${escaped}')\\]\\s*(?:#.*)?$`, 'm'));
  if (!header) throw new Error('无法找到当前 Codex 中转站配置。');
  const provider = config.slice(header.index + header[0].length).split(/^\s*\[/m)[0];
  let url;
  try {
    url = new URL(rootString(provider, 'base_url'));
    if (url.username || url.password || url.search || url.hash) throw new Error();
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error();
    url.pathname = url.pathname.replace(/\/+$/, '') + '/models';
  } catch { throw new Error('中转站 base_url 无效，请使用 HTTPS 或本机 HTTP 地址。'); }
  const envKey = rootString(provider, 'env_key');
  if (envKey && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(envKey)) throw new Error('模型 API Key 环境变量名称无效。');
  let key = envKey ? process.env[envKey] : rootString(provider, 'experimental_bearer_token');
  if (envKey && !key) {
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(directory, 'model-api-key.json'), 'utf8'));
      if (saved.url === url.href && saved.envKey === envKey) key = protect(saved.encryptedKey, true);
    } catch { /* A missing or obsolete cache requires the configured environment variable. */ }
  }
  if (envKey && !key) throw new Error(`请配置模型 API Key 环境变量 ${envKey}，然后重启 Codex。`);
  if (!envKey && !key && /^\s*requires_openai_auth\s*=\s*true\b/m.test(provider)) {
    try { key = JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')).OPENAI_API_KEY; } catch { /* Public model endpoints may allow unauthenticated access. */ }
  }
  if (typeof key !== 'string') key = undefined;
  return { url, envKey, key };
}

export function cacheModelCredentials(directory = dataDir) {
  try {
    const { url, envKey, key } = modelConnection(directory);
    if (!envKey || !process.env[envKey]) return;
    const saved = { url: url.href, envKey, encryptedKey: protect(key) };
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'model-api-key.json');
    const temporary = file + '.' + randomUUID() + '.tmp';
    try { fs.writeFileSync(temporary, JSON.stringify(saved), { mode: 0o600 }); fs.renameSync(temporary, file); }
    finally { fs.rmSync(temporary, { force: true }); }
  } catch { /* Quota startup stays available when model credentials are not configured. */ }
}

export async function fetchModels(fetcher = fetch, directory = dataDir) {
  const { url, key } = modelConnection(directory);
  let response;
  try {
    response = await fetcher(url.href, { headers: key ? { Authorization: `Bearer ${key}` } : {}, redirect: 'error', signal: AbortSignal.timeout(20000) });
  } catch { throw new Error('无法连接模型接口，请检查中转站连接后重试。'); }
  if (response.status === 401 || response.status === 403) throw new Error('模型接口认证失败，请检查 Codex 使用的模型 API Key。');
  if (!response.ok) throw new Error(`模型接口返回 HTTP ${response.status}，请稍后重试。`);
  let payload;
  try { payload = await response.json(); } catch { throw new Error('模型接口未返回有效 JSON。'); }
  return { models: publicModels(payload.data), source: url.href, fetchedAt: new Date().toISOString() };
}

function desktopState(home) {
  try { return JSON.parse(fs.readFileSync(path.join(home, '.codex-global-state.json'), 'utf8'))['electron-persisted-atom-state'] || {}; }
  catch { return {}; }
}

function mostRecentLocalThread(state) {
  const activity = Object.entries(state['thread-user-activity-times-v1'] || {}).filter(([, time]) => typeof time === 'number').sort((a, b) => b[1] - a[1]);
  for (const [key] of activity) {
    try {
      const [host, id] = JSON.parse(key);
      if (host === 'local' && typeof id === 'string') return id;
    } catch { /* Ignore obsolete activity entries. */ }
  }
  return null;
}

function threadModel(home, threadId) {
  if (!threadId) return null;
  const databases = fs.readdirSync(home).filter(name => /^state_\d+\.sqlite$/.test(name)).sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]));
  for (const file of databases) {
    let database;
    try {
      database = new DatabaseSync(path.join(home, file), { readOnly: true });
      const row = database.prepare('SELECT model FROM threads WHERE id = ? AND archived = 0').get(threadId);
      if (typeof row?.model === 'string' && row.model) return row.model;
    } catch { /* A client upgrade may temporarily expose a different schema. */ }
    finally { database?.close(); }
  }
  return null;
}

export function activeModel({ threadId } = {}) {
  const home = codexDir();
  const state = desktopState(home);
  const visible = threadId ? undefined : desktopThread();
  const selectedThread = threadId || (visible ? visible.threadId : mostRecentLocalThread(state) || process.env.CODEX_THREAD_ID);
  const selectedModel = threadModel(home, selectedThread);
  if (visible && selectedModel) return { id: selectedModel, threadId: selectedThread, source: 'desktop-visible-thread', label: '当前桌面聊天模型', scope: 'thread', warning: '根据本机桌面视图切换日志定位聊天，再读取其保存的模型。多窗口同时使用时以最近激活的聊天视图为准。' };
  if (selectedModel) return { id: selectedModel, threadId: selectedThread, source: threadId ? 'thread-state' : 'desktop-active-thread', label: threadId ? '当前聊天模型' : '最近使用的聊天模型', scope: 'thread', warning: '读取聊天保存的模型设置。多窗口时最近使用的聊天可能不同；只有右下角选择已写入聊天设置后才能同步。' };
  if (visible) return { id: null, threadId: selectedThread, source: 'desktop-view-unavailable', label: '当前聊天模型暂不可用', scope: 'thread', warning: '当前视图没有可读取的本地聊天模型。新建聊天需等待模型设置保存，也可手动指定模型。' };
  if (threadId) return { id: null, threadId, source: 'thread-unavailable', label: '聊天模型暂不可用', scope: 'thread', warning: '指定聊天的模型尚未保存，请稍后刷新。' };
  const recent = state['composer-recent-model-configurations-v1'];
  const recentModel = recent?.[0]?.model;
  if (typeof recentModel === 'string' && recentModel.trim()) return { id: recentModel, source: 'desktop-recent-selection', label: '桌面最近选择（备用）', scope: 'desktop', warning: '无法读取聊天模型，暂用桌面最近选择。可手动指定模型。' };
  const model = source().current;
  return { id: model || null, source: 'config-default', label: '配置默认模型', scope: 'default', warning: '当前无法读取桌面模型选择，显示配置默认模型，可手动指定本面板模型。' };
}
export function updateModel({ action, id, name }) {
  if (!['add', 'enable', 'disable'].includes(action)) throw new Error('未知模型操作。');
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(id)) throw new Error('模型 ID 格式无效。');
  if (['gpt-reserve', 'codex-auto-review'].includes(id)) throw new Error('这是 Codex 内部模型。');
  const lockPath = path.join(codexDir(), 'cliproxy-models.lock');
  let lock;
  try { lock = fs.openSync(lockPath, 'wx'); } catch { throw new Error('模型配置正在被其他操作修改，请稍后重试。'); }
  try {
    const state = source();
    const original = fs.readFileSync(state.catalogPath, 'utf8');
    const model = state.catalog.models.find(m => m.slug === id);
    if (action === 'disable') {
      if (!model) throw new Error('模型不存在。');
      if (state.current === id) throw new Error('这是当前默认模型。请先在 Codex 中切换默认模型，再取消显示。');
      if (state.catalog.models.filter(m => m.visibility === 'list').length <= 1) throw new Error('至少保留一个可选模型。');
      model.visibility = 'hide';
    } else if (model) model.visibility = 'list';
    else if (action === 'enable') throw new Error('模型不存在，请先添加。');
    else {
      const template = state.catalog.models.find(m => m.slug === 'gemini-3.8-flash-high') || state.catalog.models.find(m => m.visibility === 'list');
      if (!template) throw new Error('缺少可用的模型配置模板。');
      const entry = structuredClone(template);
      Object.assign(entry, { slug: id, display_name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 100) : id, description: 'Custom provider model', visibility: 'list', supported_in_api: true, upgrade: null, priority: 50 + state.catalog.models.length, service_tiers: [], additional_speed_tiers: [], availability_nux: null, available_access_programs: null, context_window: 128000, default_reasoning_level: 'high', supported_reasoning_levels: [{ effort: 'high', description: 'Provider default' }], input_modalities: ['text'] });
      if ('default_service_tier' in entry) entry.default_service_tier = null;
      if ('max_context_window' in entry) entry.max_context_window = 128000;
      for (const key of ['supports_search_tool', 'supports_image_detail_original', 'use_responses_lite', 'support_verbosity', 'supports_reasoning_effort_updates']) entry[key] = false;
      state.catalog.models.push(entry);
    }
    if (fs.readFileSync(state.catalogPath, 'utf8') !== original || fs.readFileSync(state.configPath, 'utf8') !== state.config) throw new Error('配置已被其他程序修改，请刷新后重试。');
    fs.copyFileSync(state.catalogPath, state.catalogPath + '.cliproxy.bak');
    const temporary = state.catalogPath + '.cliproxy.tmp';
    fs.writeFileSync(temporary, JSON.stringify(state.catalog, null, 2));
    fs.renameSync(temporary, state.catalogPath);
    return view(state);
  } finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
}
