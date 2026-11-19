import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { desktopThread } from './desktop.mjs';
import { dataDir, protect } from './quota.mjs';
import { randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';

const codexDir = () => process.env.CLIPROXY_CODEX_HOME || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const modelIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const reservedModel = id => ['gpt-reserve', 'codex-auto-review'].includes(id.split('/').at(-1));
const efforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
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
  const catalogText = fs.readFileSync(catalogPath, 'utf8');
  const catalog = JSON.parse(catalogText);
  if (!Array.isArray(catalog.models)) throw new Error('模型目录格式无效。');
  return { configPath, config, catalogPath, catalogText, catalog, current: rootString(config, 'model') };
}
const menuPriority = model => Number.isSafeInteger(model.priority) ? model.priority : Infinity;
function menuGroups(catalog) {
  const enabled = [], hidden = [];
  for (const model of catalog.models) {
    if (reservedModel(model.slug)) continue;
    (model.visibility === 'list' ? enabled : hidden).push(model);
  }
  enabled.sort((a, b) => menuPriority(a) - menuPriority(b));
  return { enabled, hidden };
}
function view(state) {
  const { enabled, hidden } = menuGroups(state.catalog);
  const models = [...enabled, ...hidden].map((m, index) => ({
    id: m.slug, name: m.display_name || m.slug, enabled: index < enabled.length, current: state.current === m.slug,
    canMoveUp: index > 0 && index < enabled.length,
    canMoveDown: index < enabled.length - 1,
  }));
  return { current: state.current || null, restartRequired: true, models };
}
export function listModels() { return view(source()); }

function reasoningSettings(row, excludeUltra = false) {
  if (!Array.isArray(row?.supported_reasoning_levels)) return {};
  const levels = new Map();
  for (const level of row.supported_reasoning_levels) {
    const effort = typeof level === 'string' ? level : level?.effort;
    if (!efforts.has(effort) || (excludeUltra && effort === 'ultra') || levels.has(effort)) continue;
    levels.set(effort, { effort, description: typeof level?.description === 'string' ? level.description.slice(0, 320) : '' });
  }
  if (!levels.size) return {};
  return {
    supported_reasoning_levels: [...levels.values()],
    default_reasoning_level: levels.has(row.default_reasoning_level) ? row.default_reasoning_level : levels.keys().next().value,
  };
}

export function mergeModelAliases(models) {
  const ids = new Set(models.map(row => row.id));
  return models.filter(row => !row.id.includes('/') || !ids.has(row.id.slice(row.id.indexOf('/') + 1)));
}

export function publicModels(rows, { origin, includeAliases = false } = {}) {
  if (!Array.isArray(rows)) throw new Error('模型接口未返回可识别的模型列表。');
  const models = new Map();
  for (const row of rows) {
    const id = typeof row === 'string' ? row : row?.slug ?? row?.id;
    if (typeof id !== 'string' || !modelIdPattern.test(id) || reservedModel(id)) continue;
    const name = typeof row?.display_name === 'string' ? row.display_name : id;
    // These shared routes advertise ultra, but their Responses endpoint rejects it.
    const excludeUltra = origin === 'https://ai.hangsecret.cn' && ['gpt-6.1-sol', 'gpt-6.2-sol'].includes(id);
    if (!models.has(id)) models.set(id, { id, name: name.trim().slice(0, 100) || id, ...reasoningSettings(row, excludeUltra) });
  }
  const result = [...models.values()].sort((a, b) => a.id.localeCompare(b.id));
  return includeAliases ? result : mergeModelAliases(result);
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
      key = parseEnv(fs.readFileSync(path.join(home, '.env'), 'utf8'))[envKey];
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('无法读取 Codex 用户目录下的 .env 文件，请检查文件权限和格式。');
    }
  }
  if (envKey && !key) {
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(directory, 'model-api-key.json'), 'utf8'));
      if (saved.url === url.href && saved.envKey === envKey) key = protect(saved.encryptedKey, true);
    } catch { /* A missing or obsolete cache requires the configured environment variable. */ }
  }
  if (envKey && !key) throw new Error(`未读取到模型调用密钥 ${envKey}。请检查 Codex 用户目录下的 .env 或进程环境变量，然后重试拉取。`);
  if (!envKey && !key && /^\s*requires_openai_auth\s*=\s*true\b/m.test(provider)) {
    try { key = JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')).OPENAI_API_KEY; } catch { /* Public model endpoints may allow unauthenticated access. */ }
  }
  if (typeof key !== 'string') key = undefined;
  return { url, envKey, key };
}

export function cacheModelCredentials(directory = dataDir) {
  try {
    const { url, envKey, key } = modelConnection(directory);
    if (!envKey || !key) return;
    const saved = { url: url.href, envKey, encryptedKey: protect(key) };
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'model-api-key.json');
    const temporary = file + '.' + randomUUID() + '.tmp';
    try { fs.writeFileSync(temporary, JSON.stringify(saved), { mode: 0o600 }); fs.renameSync(temporary, file); }
    finally { fs.rmSync(temporary, { force: true }); }
  } catch { /* Quota startup stays available when model credentials are not configured. */ }
}

async function requestModels(url, key, fetcher, timeout, includeAliases) {
  let response;
  try {
    response = await fetcher(url.href, { headers: key ? { Authorization: `Bearer ${key}` } : {}, redirect: 'error', signal: AbortSignal.timeout(timeout) });
  } catch { throw new Error('无法连接模型接口，请检查中转站连接后重试。'); }
  if (response.status === 401 || response.status === 403) {
    const error = new Error('模型接口认证失败，请检查 Codex 使用的模型 API Key。');
    error.authentication = true;
    throw error;
  }
  if (!response.ok) throw new Error(`模型接口返回 HTTP ${response.status}，请稍后重试。`);
  let payload;
  try { payload = await response.json(); } catch { throw new Error('模型接口未返回有效 JSON。'); }
  const rows = Array.isArray(payload?.models) ? payload.models : payload?.data;
  return { models: publicModels(rows, { origin: url.origin, includeAliases }), source: url.href, fetchedAt: new Date().toISOString() };
}

export async function fetchModels(fetcher = fetch, directory = dataDir, { includeAliases = false } = {}) {
  const { url, key } = modelConnection(directory);
  const detailed = new URL(url);
  detailed.searchParams.set('client_version', '');
  try {
    return await requestModels(detailed, key, fetcher, 75000, includeAliases);
  } catch (error) {
    if (error.authentication) throw error;
    return requestModels(url, key, fetcher, 20000, includeAliases);
  }
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
function editCatalog(edit) {
  const lockPath = path.join(codexDir(), 'cliproxy-models.lock');
  let lock;
  try { lock = fs.openSync(lockPath, 'wx'); } catch { throw new Error('模型配置正在被其他操作修改，请稍后重试。'); }
  try {
    const state = source();
    const changed = edit(state);
    if (!changed) return { state, changed };
    if (fs.readFileSync(state.catalogPath, 'utf8') !== state.catalogText || fs.readFileSync(state.configPath, 'utf8') !== state.config) throw new Error('配置已被其他程序修改，请刷新后重试。');
    fs.copyFileSync(state.catalogPath, state.catalogPath + '.cliproxy.bak');
    const temporary = state.catalogPath + '.cliproxy.tmp';
    try {
      fs.writeFileSync(temporary, JSON.stringify(state.catalog, null, 2));
      fs.renameSync(temporary, state.catalogPath);
    } finally { fs.rmSync(temporary, { force: true }); }
    return { state, changed };
  } finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
}

export function syncModelReasoning(models) {
  const remote = new Map(models.filter(row => row.supported_reasoning_levels?.length).map(row => [row.id, row]));
  if (!remote.size) return { ...listModels(), updatedReasoning: 0 };
  const { state, changed } = editCatalog(state => {
    let changed = 0;
    for (const model of state.catalog.models) {
      const row = remote.get(model.slug);
      if (!row) continue;
      const reasoning = reasoningSettings(row);
      if (!reasoning.supported_reasoning_levels) continue;
      if (model.default_reasoning_level === reasoning.default_reasoning_level &&
          JSON.stringify(model.supported_reasoning_levels) === JSON.stringify(reasoning.supported_reasoning_levels)) continue;
      Object.assign(model, reasoning);
      changed++;
    }
    return changed;
  });
  return { ...view(state), updatedReasoning: changed };
}

export function updateModel({ action, id, name }, offered) {
  const moving = action === 'move-up' || action === 'move-down';
  if (!moving && !['add', 'enable', 'disable'].includes(action)) throw new Error('未知模型操作。');
  if (typeof id !== 'string' || !modelIdPattern.test(id)) throw new Error('模型 ID 格式无效。');
  if (reservedModel(id)) throw new Error('这是 Codex 内部模型。');
  const reasoning = offered?.id === id ? reasoningSettings(offered) : {};
  const { state } = editCatalog(state => {
    if (moving) {
      const { enabled } = menuGroups(state.catalog);
      const index = enabled.findIndex(m => m.slug === id);
      if (index < 0) throw new Error('只能移动已显示的模型。');
      const target = index + (action === 'move-up' ? -1 : 1);
      if (target < 0 || target >= enabled.length) return false;
      const priorities = enabled.map(menuPriority);
      if (priorities.includes(Infinity) || new Set(priorities).size !== enabled.length) {
        // Codex preserves catalog order for equal priorities. Give the moved list distinct ranks.
        [enabled[index], enabled[target]] = [enabled[target], enabled[index]];
        enabled.forEach((model, position) => { model.priority = position; });
      } else {
        [enabled[index].priority, enabled[target].priority] = [enabled[target].priority, enabled[index].priority];
      }
      return true;
    }
    const model = state.catalog.models.find(m => m.slug === id);
    if (action === 'disable') {
      if (!model) throw new Error('模型不存在。');
      if (state.current === id) throw new Error('这是当前默认模型。请先在 Codex 中切换默认模型，再取消显示。');
      if (state.catalog.models.filter(m => m.visibility === 'list').length <= 1) throw new Error('至少保留一个可选模型。');
      model.visibility = 'hide';
    } else if (model) Object.assign(model, { visibility: 'list' }, reasoning);
    else if (action === 'enable') throw new Error('模型不存在，请先添加。');
    else {
      const template = state.catalog.models.find(m => m.slug === 'gemini-3.8-flash-high') || state.catalog.models.find(m => m.visibility === 'list');
      if (!template) throw new Error('缺少可用的模型配置模板。');
      const entry = structuredClone(template);
      Object.assign(entry, { slug: id, display_name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 100) : id, description: 'Custom provider model', visibility: 'list', supported_in_api: true, upgrade: null, priority: 50 + state.catalog.models.length, service_tiers: [], additional_speed_tiers: [], availability_nux: null, available_access_programs: null, context_window: 128000, default_reasoning_level: 'high', supported_reasoning_levels: [{ effort: 'high', description: 'Provider default' }], input_modalities: ['text'] });
      if ('default_service_tier' in entry) entry.default_service_tier = null;
      if ('max_context_window' in entry) entry.max_context_window = 128000;
      for (const key of ['supports_search_tool', 'supports_image_detail_original', 'use_responses_lite', 'support_verbosity', 'supports_reasoning_effort_updates']) entry[key] = false;
      Object.assign(entry, reasoning);
      state.catalog.models.push(entry);
    }
    return true;
  });
  return view(state);
}
