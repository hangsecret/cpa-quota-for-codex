import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';

test('global launcher opens the desktop automatically, deduplicates and allows retry', async () => {
  const elements = { status: {}, open: {} };
  const handlers = new Map();
  let launches = 0;
  let failure = false;
  const parent = {
    postMessage(message) {
      if (message.id === undefined) return;
      let result = { hostContext: { theme: 'dark' } };
      if (message.method === 'tools/call') {
        assert.equal(message.params.name, 'open_desktop_panel');
        launches++;
        result = failure ? { isError: true, content: [{ type: 'text', text: '测试启动失败' }] } : { structuredContent: { opened: true } };
      }
      queueMicrotask(() => handlers.get('message')({ source: parent, data: { jsonrpc: '2.0', id: message.id, result } }));
    }
  };
  const document = { getElementById: id => elements[id], documentElement: { style: {} } };
  const context = vm.createContext({ document, parent, window: { addEventListener: (name, callback) => handlers.set(name, callback) }, setTimeout: () => 1, clearTimeout() {} });
  vm.runInContext(fs.readFileSync(new URL('app.js', import.meta.url), 'utf8'), context);
  await setImmediate();
  assert.equal(launches, 1);
  assert.equal(document.documentElement.style.colorScheme, 'dark');
  assert.match(elements.status.textContent, /已发送启动请求/);
  assert.equal(elements.open.disabled, false);
  failure = true;
  const failed = elements.open.onclick();
  await elements.open.onclick();
  await failed;
  assert.equal(launches, 2);
  assert.match(elements.status.textContent, /测试启动失败/);
  failure = false;
  await elements.open.onclick();
  assert.equal(launches, 3);
  handlers.get('message')({ source: parent, data: { jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { 'openai/deepLink': { path: '/' } } } });
  await setImmediate();
  assert.equal(launches, 4);
});
