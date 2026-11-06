import fs from 'node:fs';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { settings, saveSettings, queryQuota } from './quota.mjs';
import { listModels, updateModel, activeModel } from './models.mjs';
import { openDesktopPanel, autoStartDesktopPanel } from './pet-launch.mjs';

const resourceUri = 'ui://cliproxy/desktop-launcher-v1.html';
const icons = [{ src: 'data:image/png;base64,' + fs.readFileSync(new URL('pet/quota-icon.png', import.meta.url)).toString('base64'), mimeType: 'image/png', sizes: ['256x256'] }];
const emptySchema = { type: 'object', properties: {}, additionalProperties: false };
const appOnly = { ui: { visibility: ['app'] }, 'openai/visibility': 'private', 'openai/widgetAccessible': true };
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
export const tools = [
  { name: 'open_desktop_panel', title: '打开桌面悬浮面板', description: '打开桌面紧凑额度悬浮窗，可拖动及托盘隐藏，支持额度查询、模型跟随和模型管理。', inputSchema: emptySchema, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }, _meta: { ui: { visibility: ['model', 'app'] }, 'openai/widgetAccessible': true } },
  { name: 'open_quota_console', title: '额度与模型', icons, description: '从 Plugins 的“打开插件”进入桌面悬浮窗启动器。进入后自动启动或显示已有桌面窗口。', inputSchema: emptySchema, annotations: readOnly, _meta: { ui: { resourceUri }, 'openai/outputTemplate': resourceUri, 'openai/widgetAccessible': true, 'openai/ui': { entrypoints: [{ type: 'global' }] } } },
  { name: 'get_quota', description: '查询 CLIProxy 账户剩余配额和重置时间。', inputSchema: { type: 'object', properties: { refresh: { type: 'boolean' } }, additionalProperties: false }, annotations: { ...readOnly, openWorldHint: true } },
  { name: 'get_console_settings', description: '读取插件连接设置，不返回密钥。', inputSchema: emptySchema, annotations: readOnly, _meta: appOnly },
  { name: 'save_console_settings', description: '保存用户输入的 CLIProxy 管理连接，用 Windows DPAPI 加密密钥。', inputSchema: { type: 'object', properties: { baseUrl: { type: 'string' }, apiVersion: { enum: ['v8', 'v0'] }, managementKey: { type: 'string' } }, required: ['baseUrl', 'apiVersion'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }, _meta: appOnly },
  { name: 'list_models', description: '读取 Codex 模型菜单的显示状态。', inputSchema: emptySchema, annotations: readOnly },
  { name: 'get_model_focus', description: '自动定位桌面最近激活的聊天视图并读取保存的模型，也可显式查询指定聊天。', inputSchema: { type: 'object', properties: { threadId: { type: 'string' } }, additionalProperties: false }, annotations: readOnly, _meta: appOnly },
  { name: 'update_model', description: '按用户操作添加模型，或启用、取消模型在 Codex 下拉菜单中的显示。', inputSchema: { type: 'object', properties: { action: { enum: ['add', 'enable', 'disable'] }, id: { type: 'string' }, name: { type: 'string' } }, required: ['action', 'id'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }, _meta: appOnly }
];
function publicSettings() {
  const config = settings();
  return { baseUrl: config.baseUrl, apiVersion: config.apiVersion, configured: !!(config.encryptedKey || process.env.CLIPROXY_MANAGEMENT_KEY), backendVersion: '2.7.1' };
}
export async function execute(name, args = {}) {
  if (name === 'open_desktop_panel') return openDesktopPanel();
  if (name === 'open_quota_console') return { launcher: true };
  if (name === 'get_quota') return queryQuota(args.refresh === true);
  if (name === 'get_console_settings') return publicSettings();
  if (name === 'save_console_settings') { saveSettings(args); return publicSettings(); }
  if (name === 'list_models') return listModels();
  if (name === 'get_model_focus') return activeModel(args);
  if (name === 'update_model') return updateModel(args);
  throw new Error('未知工具。');
}
export function appResource() {
  let html = fs.readFileSync(new URL('dashboard.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('style.css', import.meta.url), 'utf8');
  const js = fs.readFileSync(new URL('app.js', import.meta.url), 'utf8').replaceAll('</script', '<\\/script');
  html = html.replace('<link rel="stylesheet" href="/style.css">', `<style>${css}</style>`).replace('<script src="/app.js" defer></script>', `<script type="module">${js}</script>`);
  return { uri: resourceUri, mimeType: 'text/html;profile=mcp-app', text: html, _meta: { ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [] } } } };
}
let initialDesktopStart;
function checkDesktopStartup(attempts) {
  autoStartDesktopPanel().catch(() => process.stderr.write('桌面悬浮窗自动启动失败，可从 Plugins 手动打开。\n')).finally(() => {
    if (attempts > 1) {
      const timer = setTimeout(() => checkDesktopStartup(attempts - 1), 5000);
      timer.unref();
    }
  });
}
async function dispatch(message) {
  const { id, method, params = {} } = message;
  if (id === undefined) return;
  const reply = result => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  if (method === 'initialize') {
    if (!initialDesktopStart) {
      initialDesktopStart = autoStartDesktopPanel().catch(() => process.stderr.write('桌面悬浮窗自动启动失败，可从 Plugins 手动打开。\n'));
      initialDesktopStart.then(() => {
        const timer = setTimeout(() => checkDesktopStartup(2), 5000);
        timer.unref();
      });
    }
    await initialDesktopStart;
    reply({ protocolVersion: params.protocolVersion === '2024-11-05' ? '2024-11-05' : '2025-11-25', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'cliproxy-quota', title: '额度与模型', icons, version: '2.7.1' } });
    return;
  }
  if (method === 'ping') return reply({});
  if (method === 'tools/list') return reply({ tools });
  if (method === 'resources/list') return reply({ resources: [{ uri: resourceUri, name: '额度与模型', mimeType: 'text/html;profile=mcp-app' }] });
  if (method === 'resources/templates/list') return reply({ resourceTemplates: [] });
  if (method === 'resources/read' && params.uri === resourceUri) return reply({ contents: [appResource()] });
  if (method === 'tools/call') {
    try {
      const value = await execute(params.name, params.arguments);
      return reply({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
    } catch (error) { return reply({ isError: true, content: [{ type: 'text', text: error.message }] }); }
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on('line', line => {
    if (line.length > 1024 * 1024) return;
    try { dispatch(JSON.parse(line)).catch(() => {}); }
    catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); }
  });
}
