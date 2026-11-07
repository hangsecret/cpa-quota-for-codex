const requests = new Map();
let requestId = 0;
let starting = false;
let hostReady;
const status = document.getElementById('status');
const open = document.getElementById('open');

function rpc(method, params) {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { requests.delete(id); reject(new Error('连接超时，请重新打开插件。')); }, 20000);
    requests.set(id, { resolve, reject, timer });
    parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
  });
}
function theme(context) {
  if (context?.theme) document.documentElement.style.colorScheme = context.theme;
}
window.addEventListener('message', event => {
  if (event.source !== parent || event.data?.jsonrpc !== '2.0') return;
  const message = event.data;
  const pending = requests.get(message.id);
  if (pending) {
    clearTimeout(pending.timer);
    requests.delete(message.id);
    message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
  }
  if (message.method === 'ui/notifications/host-context-changed') {
    theme(message.params);
    if (message.params?.['openai/deepLink']) openPanel();
  }
  if (message.method === 'ping' || message.method === 'ui/resource-teardown') {
    if (message.id !== undefined) parent.postMessage({ jsonrpc: '2.0', id: message.id, result: {} }, '*');
  }
});
async function openPanel() {
  if (starting) return;
  starting = true;
  open.disabled = true;
  status.textContent = '正在打开桌面悬浮窗口…';
  try {
    await hostReady;
    const result = await rpc('tools/call', { name: 'open_desktop_panel', arguments: {} });
    if (result.isError) throw new Error(result.content?.find(item => item.type === 'text')?.text || '启动失败');
    status.textContent = '已发送启动请求。窗口可通过系统托盘显示或隐藏。';
    open.textContent = '再次显示悬浮窗';
  } catch (error) {
    status.textContent = error.message;
    open.textContent = '重试打开悬浮窗';
  } finally { starting = false; open.disabled = false; }
}
open.onclick = openPanel;
hostReady = rpc('ui/initialize', {
  protocolVersion: '2026-01-26', appInfo: { name: 'cliproxy-desktop-launcher', version: '2.9.0' }, appCapabilities: {}
}).then(result => {
  theme(result.hostContext);
  parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*');
});
openPanel();
