import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { desktopThread } from './desktop.mjs';

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
