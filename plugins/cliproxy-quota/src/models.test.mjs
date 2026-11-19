import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { listModels, updateModel, activeModel, publicModels, fetchModels, cacheModelCredentials, syncModelReasoning } from './models.mjs';

test('public model list merges account aliases only when a usable shared ID exists', () => {
  const result = publicModels([
    { id: 'zane/gpt-6.1-sol' }, { id: 'secret/gpt-6.1-sol' }, { id: 'gpt-6.1-sol', display_name: 'GPT' },
    { id: 'gpt-6.1-sol' }, { id: 'devin/claude-opus-5-5' }, { id: 'org/model' }, { id: 'account/org/model' },
    { id: 'only-a/private' }, { id: 'only-b/private' }, { id: 'codex-auto-review' },
    { id: 'account/codex-auto-review' }, null, { id: 'invalid\nmodel' }, { id: '' }, {},
  ]);
  assert.deepEqual(result.map(row => row.id), ['devin/claude-opus-5-5', 'gpt-6.1-sol', 'only-a/private', 'only-b/private', 'org/model']);
  assert.equal(result.find(row => row.id === 'gpt-6.1-sol').name, 'GPT');
  assert.throws(() => publicModels({ models: [] }), /模型列表/);
  assert.deepEqual(publicModels([]), []);
});

test('model fetching uses current provider API credentials and leaves the menu unchanged', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-fetch-models-'));
  const previousHome = process.env.CLIPROXY_CODEX_HOME;
  const previousKey = process.env.QUOTA_TEST_MODEL_KEY;
  process.env.CLIPROXY_CODEX_HOME = directory;
  process.env.QUOTA_TEST_MODEL_KEY = 'test-model-key';
  t.after(() => {
    if (previousHome === undefined) delete process.env.CLIPROXY_CODEX_HOME; else process.env.CLIPROXY_CODEX_HOME = previousHome;
    if (previousKey === undefined) delete process.env.QUOTA_TEST_MODEL_KEY; else process.env.QUOTA_TEST_MODEL_KEY = previousKey;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const configPath = path.join(directory, 'config.toml');
  const original = 'model_provider = "relay"\n[model_providers.other]\nbase_url = "https://wrong.example/v1"\n[model_providers.relay]\nbase_url = "https://relay.example/v1/"\nenv_key = "QUOTA_TEST_MODEL_KEY"\n';
  fs.writeFileSync(configPath, original);
  const result = await fetchModels(async (url, options) => {
    assert.equal(url, 'https://relay.example/v1/models?client_version=');
    assert.equal(options.headers.Authorization, 'Bearer test-model-key');
    assert.equal(options.redirect, 'error');
    return Response.json({ models: [
      { slug: 'gpt', display_name: 'GPT', supported_reasoning_levels: [{ effort: 'low', description: 'Fast' }, 'high', 'bad-value', 'high'], default_reasoning_level: 'high', arbitrary: 'skip' },
      { slug: 'account/gpt', supported_reasoning_levels: ['medium'], default_reasoning_level: 'medium' },
    ] });
  });
  assert.deepEqual(result.models, [{ id: 'gpt', name: 'GPT', supported_reasoning_levels: [{ effort: 'low', description: 'Fast' }, { effort: 'high', description: '' }], default_reasoning_level: 'high' }]);
  const urls = [];
  const fallback = await fetchModels(async url => {
    urls.push(url);
    return url.endsWith('?client_version=') ? new Response('', { status: 400 }) : Response.json({ data: [{ id: 'fallback-model' }] });
  });
  assert.deepEqual(urls, ['https://relay.example/v1/models?client_version=', 'https://relay.example/v1/models']);
  assert.deepEqual(fallback.models, [{ id: 'fallback-model', name: 'fallback-model' }]);
  assert.equal(fs.readFileSync(configPath, 'utf8'), original);
  assert.deepEqual(fs.readdirSync(directory), ['config.toml']);
  assert(!JSON.stringify(result).includes('test-model-key'));
  fs.writeFileSync(configPath, original.replace('[model_providers.relay]', '[model_providers."relay"]'));
  assert.equal((await fetchModels(async () => Response.json({ data: ['gpt'] }))).models.length, 1);
  await assert.rejects(fetchModels(async () => { throw new Error('test-model-key'); }), /无法连接模型接口/);
  let authCalls = 0;
  await assert.rejects(fetchModels(async () => { authCalls++; return new Response('', { status: 401 }); }), /模型接口认证失败/);
  assert.equal(authCalls, 1);
  await assert.rejects(fetchModels(async () => Response.json({ models: {} })), /模型列表/);
  await assert.rejects(fetchModels(async () => new Response('<html>')), /有效 JSON/);
  await assert.rejects(fetchModels(async () => new Response('', { status: 500 })), /HTTP 500/);
  if (process.platform === 'win32') {
    cacheModelCredentials(directory);
    const saved = fs.readFileSync(path.join(directory, 'model-api-key.json'), 'utf8');
    assert(!saved.includes('test-model-key'));
    delete process.env.QUOTA_TEST_MODEL_KEY;
    await fetchModels(async (url, options) => { assert.equal(options.headers.Authorization, 'Bearer test-model-key'); return Response.json({ data: [] }); }, directory);
    fs.writeFileSync(configPath, original.replace('https://relay.example/v1/', 'https://other.example/v1/'));
    await assert.rejects(fetchModels(async () => { throw new Error('Should not fetch'); }, directory), /QUOTA_TEST_MODEL_KEY/);
    fs.writeFileSync(configPath, original);
  }
  delete process.env.QUOTA_TEST_MODEL_KEY;
  await assert.rejects(fetchModels(async () => { throw new Error('Should not fetch'); }, path.join(directory, 'missing-cache')), /QUOTA_TEST_MODEL_KEY/);
});

test('public model requests do not borrow unrelated auth keys and reject credential-bearing URLs', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-model-auth-'));
  const previous = process.env.CLIPROXY_CODEX_HOME;
  process.env.CLIPROXY_CODEX_HOME = directory;
  t.after(() => {
    if (previous === undefined) delete process.env.CLIPROXY_CODEX_HOME; else process.env.CLIPROXY_CODEX_HOME = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const configPath = path.join(directory, 'config.toml');
  fs.writeFileSync(path.join(directory, 'auth.json'), '{"OPENAI_API_KEY":"stored-test-key"}');
  const config = 'model_provider = "relay"\n[model_providers.relay]\nbase_url = "http://127.0.0.1:8317/v1"\n';
  fs.writeFileSync(configPath, config);
  await fetchModels(async (url, options) => { assert.deepEqual(options.headers, {}); return Response.json({ data: [] }); });
  fs.appendFileSync(configPath, 'requires_openai_auth = true\n');
  await fetchModels(async (url, options) => { assert.equal(options.headers.Authorization, 'Bearer stored-test-key'); return Response.json({ data: [] }); });
  fs.writeFileSync(configPath, config + 'experimental_bearer_token = "inline-test-key"\n');
  await fetchModels(async (url, options) => { assert.equal(options.headers.Authorization, 'Bearer inline-test-key'); return Response.json({ data: [] }); });
  for (const base of ['https://user:password@example.com/v1', 'https://example.com/v1?key=value', 'http://example.com/v1']) {
    fs.writeFileSync(configPath, config.replace('http://127.0.0.1:8317/v1', base));
    await assert.rejects(fetchModels(async () => { throw new Error('Should not fetch'); }), /base_url 无效/);
  }
});

test('first install reads the configured key from Codex .env without a process variable or cache', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-env-file-'));
  const previousHome = process.env.CLIPROXY_CODEX_HOME;
  const previousKey = process.env.QUOTA_TEST_ENV_FILE_KEY;
  process.env.CLIPROXY_CODEX_HOME = directory;
  delete process.env.QUOTA_TEST_ENV_FILE_KEY;
  t.after(() => {
    if (previousHome === undefined) delete process.env.CLIPROXY_CODEX_HOME; else process.env.CLIPROXY_CODEX_HOME = previousHome;
    if (previousKey === undefined) delete process.env.QUOTA_TEST_ENV_FILE_KEY; else process.env.QUOTA_TEST_ENV_FILE_KEY = previousKey;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const config = 'model_provider = "relay"\n[model_providers.relay]\nbase_url = "https://relay.example/v1"\nenv_key = "QUOTA_TEST_ENV_FILE_KEY"\n';
  const configPath = path.join(directory, 'config.toml');
  const envPath = path.join(directory, '.env');
  fs.writeFileSync(configPath, config);
  const originalEnv = '# user credentials\r\nUNRELATED_VARIABLE="ignored"\r\nexport QUOTA_TEST_ENV_FILE_KEY = "first#test=value" # comment\r\n';
  fs.writeFileSync(envPath, originalEnv);
  const data = path.join(directory, 'plugin-data');
  assert(!fs.existsSync(data));
  let expectedKey = 'first#test=value';
  const fetcher = async (url, options) => {
    assert.equal(url, 'https://relay.example/v1/models?client_version=');
    assert.equal(options.headers.Authorization, `Bearer ${expectedKey}`);
    return Response.json({ data: [{ id: 'gpt-test' }] });
  };
  const first = await fetchModels(fetcher, data);
  assert.deepEqual(first.models.map(row => row.id), ['gpt-test']);
  assert(!fs.existsSync(data));
  assert.equal(fs.readFileSync(envPath, 'utf8'), originalEnv);
  assert.equal(fs.readFileSync(configPath, 'utf8'), config);
  assert.equal(process.env.UNRELATED_VARIABLE, undefined);
  if (process.platform === 'win32') {
    cacheModelCredentials(data);
    const saved = fs.readFileSync(path.join(data, 'model-api-key.json'), 'utf8');
    assert(!saved.includes(expectedKey));
    assert.equal(JSON.parse(saved).envKey, 'QUOTA_TEST_ENV_FILE_KEY');
  }
  fs.writeFileSync(envPath, "QUOTA_TEST_ENV_FILE_KEY='updated-test-value'\n");
  expectedKey = 'updated-test-value';
  await fetchModels(fetcher, data);
  process.env.QUOTA_TEST_ENV_FILE_KEY = 'process-override';
  expectedKey = 'process-override';
  await fetchModels(fetcher, data);
  delete process.env.QUOTA_TEST_ENV_FILE_KEY;
  fs.writeFileSync(envPath, 'UNRELATED_VARIABLE=other\n');
  await assert.rejects(fetchModels(fetcher, path.join(directory, 'empty-data')), /QUOTA_TEST_ENV_FILE_KEY/);
});

test('model management preserves existing capabilities and protects the default', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-models-'));
  const originalHome = process.env.CLIPROXY_CODEX_HOME;
  const originalLogs = process.env.CLIPROXY_CODEX_LOGS;
  process.env.CLIPROXY_CODEX_HOME = directory;
  process.env.CLIPROXY_CODEX_LOGS = path.join(directory, 'logs');
  try {
    const catalogPath = path.join(directory, 'models.json');
    const config = `model = "default"\nmodel_catalog_json = '${catalogPath.replaceAll('\\', '/')}'\n[desktop]\nmode = "normal"\n`;
    fs.writeFileSync(path.join(directory, 'config.toml'), config);
    const baseline = { slug: 'default', display_name: 'Default', visibility: 'list', custom_field: 'keep', model_messages: { instructions_template: 'preserve instructions' } };
    fs.writeFileSync(catalogPath, JSON.stringify({ models: [baseline, { ...baseline, slug: 'other' }] }));
    assert.equal(activeModel().source, 'config-default');
    const stateFile = path.join(directory, '.codex-global-state.json');
    fs.writeFileSync(stateFile, JSON.stringify({ 'electron-persisted-atom-state': { 'composer-recent-model-configurations-v1': [{ model: 'provider/selected' }] } }));
    assert.equal(activeModel().id, 'provider/selected');
    assert.equal(activeModel().source, 'desktop-recent-selection');
    fs.writeFileSync(stateFile, JSON.stringify({ 'electron-persisted-atom-state': { 'composer-recent-model-configurations-v1': [{ model: 'provider/changed' }] } }));
    assert.equal(activeModel().id, 'provider/changed');
    assert.throws(() => updateModel({ action: 'disable', id: 'default' }), /默认模型/);
    updateModel({ action: 'disable', id: 'other' });
    assert.equal(listModels().models.find(m => m.id === 'other').enabled, false);
    updateModel({ action: 'enable', id: 'other' });
    updateModel({ action: 'add', id: 'provider/new-model', name: 'New Model' });
    updateModel({ action: 'add', id: 'provider/new-model' });
    const after = JSON.parse(fs.readFileSync(catalogPath));
    assert.equal(after.models.filter(m => m.slug === 'provider/new-model').length, 1);
    assert.deepEqual(after.models[0], baseline);
    assert.equal(fs.readFileSync(path.join(directory, 'config.toml'), 'utf8'), config);
    assert(fs.existsSync(catalogPath + '.cliproxy.bak'));
    assert.throws(() => updateModel({ action: 'add', id: 'invalid\nmodel' }), /格式无效/);
    assert.throws(() => updateModel({ action: 'enable', id: 'missing' }), /不存在/);
    assert(!fs.existsSync(path.join(directory, 'cliproxy-models.lock')));
  } finally {
    if (originalHome === undefined) delete process.env.CLIPROXY_CODEX_HOME;
    else process.env.CLIPROXY_CODEX_HOME = originalHome;
    if (originalLogs === undefined) delete process.env.CLIPROXY_CODEX_LOGS;
    else process.env.CLIPROXY_CODEX_LOGS = originalLogs;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('moving a visible model persists the exact menu order while preserving hidden models and settings', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-model-order-'));
  const previous = process.env.CLIPROXY_CODEX_HOME;
  process.env.CLIPROXY_CODEX_HOME = directory;
  t.after(() => {
    if (previous === undefined) delete process.env.CLIPROXY_CODEX_HOME; else process.env.CLIPROXY_CODEX_HOME = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const config = path.join(directory, 'config.toml');
  const configText = 'model = "second"\nmodel_catalog_json = "models.json"\n';
  fs.writeFileSync(config, configText);
  const catalogPath = path.join(directory, 'models.json');
  const hidden = { slug: 'hidden', visibility: 'hide', priority: 1 };
  const reserved = { slug: 'gpt-reserve', visibility: 'list', priority: 99 };
  const initial = { models: [
    { slug: 'last', visibility: 'list', priority: 12 },
    hidden,
    { slug: 'first', visibility: 'list', priority: 1 },
    { slug: 'second', visibility: 'list', priority: 1, default_reasoning_level: 'high' },
    reserved,
  ] };
  const original = JSON.stringify(initial);
  fs.writeFileSync(catalogPath, original);
  const order = state => state.models.filter(m => m.enabled).map(m => m.id);
  assert.deepEqual(order(listModels()), ['first', 'second', 'last']);
  const moved = updateModel({ action: 'move-up', id: 'second' });
  assert.deepEqual(order(moved), ['second', 'first', 'last']);
  assert.equal(moved.models[0].current, true);
  assert.equal(moved.models[0].canMoveUp, false);
  assert.equal(moved.models[0].canMoveDown, true);
  assert.equal(moved.models[2].canMoveDown, false);
  assert.equal(moved.models[3].canMoveUp, false);
  const saved = fs.readFileSync(catalogPath, 'utf8');
  const savedModels = JSON.parse(saved).models;
  assert.deepEqual(savedModels.map(m => m.priority), [2, 1, 1, 0, 99]);
  assert.deepEqual(savedModels[1], hidden);
  assert.deepEqual(savedModels[4], reserved);
  assert.equal(savedModels[3].default_reasoning_level, 'high');
  assert.equal(fs.readFileSync(config, 'utf8'), configText);
  assert.equal(fs.readFileSync(catalogPath + '.cliproxy.bak', 'utf8'), original);
  assert.throws(() => updateModel({ action: 'move-down', id: 'hidden' }), /已显示/);
  updateModel({ action: 'move-up', id: 'second' });
  assert.equal(fs.readFileSync(catalogPath, 'utf8'), saved);
  assert.equal(fs.readFileSync(catalogPath + '.cliproxy.bak', 'utf8'), original);
  updateModel({ action: 'move-down', id: 'second' });
  assert.deepEqual(order(listModels()), ['first', 'second', 'last']);
});

test('a provider refresh updates reasoning on exact existing routes and offers it for checkbox adds', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-model-reasoning-'));
  const previous = process.env.CLIPROXY_CODEX_HOME;
  process.env.CLIPROXY_CODEX_HOME = directory;
  try {
    const catalog = path.join(directory, 'models.json');
    fs.writeFileSync(path.join(directory, 'config.toml'), 'model = "gpt-6.1-sol"\nmodel_catalog_json = "models.json"\n');
    const gpt = { slug: 'gpt-6.1-sol', visibility: 'list', default_reasoning_level: 'high', supported_reasoning_levels: [{ effort: 'high', description: 'Old' }], model_messages: { instructions_template: 'local' } };
    const hidden = { slug: 'account/gpt-6.1-sol', visibility: 'hide' };
    const absent = { slug: 'local-manual', visibility: 'list', default_reasoning_level: 'xhigh' };
    const original = JSON.stringify({ models: [gpt, hidden, absent], extra: 'keep' });
    fs.writeFileSync(catalog, original);
    const rows = [
      { slug: gpt.slug, supported_reasoning_levels: ['low', 'high', 'ultra'], default_reasoning_level: 'low' },
      { slug: hidden.slug, supported_reasoning_levels: ['medium', 'high'], default_reasoning_level: 'high' },
      { slug: absent.slug, supported_reasoning_levels: ['not-a-level'], default_reasoning_level: 'not-a-level' },
      { slug: 'devin/new', supported_reasoning_levels: ['medium', 'high', 'max'], default_reasoning_level: 'medium' },
    ];
    const offered = publicModels(rows, { origin: 'https://ai.hangsecret.cn', includeAliases: true });
    assert.equal(syncModelReasoning(offered).updatedReasoning, 2);
    const changed = JSON.parse(fs.readFileSync(catalog, 'utf8'));
    assert.equal(changed.extra, 'keep');
    assert.equal(changed.models.length, 3);
    assert.deepEqual(changed.models[0].supported_reasoning_levels.map(x => x.effort), ['low', 'high']);
    assert.equal(changed.models[0].default_reasoning_level, 'low');
    assert.deepEqual(changed.models[0].model_messages, gpt.model_messages);
    assert.equal(changed.models[1].visibility, 'hide');
    assert.equal(changed.models[1].default_reasoning_level, 'high');
    assert.deepEqual(changed.models[2], absent);
    assert.deepEqual(publicModels(rows).find(row => row.id === gpt.slug).supported_reasoning_levels.map(x => x.effort), ['low', 'high', 'ultra']);
    assert.equal(syncModelReasoning(offered).updatedReasoning, 0);
    assert.equal(fs.readFileSync(catalog + '.cliproxy.bak', 'utf8'), original);
    updateModel({ action: 'add', id: 'devin/new' }, offered.find(row => row.id === 'devin/new'));
    const added = JSON.parse(fs.readFileSync(catalog, 'utf8')).models.at(-1);
    assert.equal(added.default_reasoning_level, 'medium');
    assert.deepEqual(added.supported_reasoning_levels.map(x => x.effort), ['medium', 'high', 'max']);
  } finally {
    if (previous === undefined) delete process.env.CLIPROXY_CODEX_HOME; else process.env.CLIPROXY_CODEX_HOME = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('saved chat models override the global cache when view logs are unavailable', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-selection-'));
  const originalHome = process.env.CLIPROXY_CODEX_HOME;
  const originalLogs = process.env.CLIPROXY_CODEX_LOGS;
  process.env.CLIPROXY_CODEX_HOME = directory;
  process.env.CLIPROXY_CODEX_LOGS = path.join(directory, 'logs');
  const database = new DatabaseSync(path.join(directory, 'state_5.sqlite'));
  try {
    database.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, model TEXT, archived INTEGER)');
    const insert = database.prepare('INSERT INTO threads VALUES (?, ?, 0)');
    insert.run('current-chat', 'gemini-3.8-flash-high');
    insert.run('other-chat', 'gpt-6.1-sol');
    const state = {
      'composer-recent-model-configurations-v1': [{ model: 'gpt-6.1-sol' }],
      'thread-user-activity-times-v1': { '["local","current-chat"]': 20, '["local","other-chat"]': 10 }
    };
    const saveState = () => fs.writeFileSync(path.join(directory, '.codex-global-state.json'), JSON.stringify({ 'electron-persisted-atom-state': state }));
    saveState();
    assert.equal(activeModel().id, 'gemini-3.8-flash-high');
    database.prepare('UPDATE threads SET model = ? WHERE id = ?').run('devin/claude-opus-5-5', 'current-chat');
    assert.equal(activeModel({ threadId: 'current-chat' }).id, 'devin/claude-opus-5-5');
    state['thread-user-activity-times-v1']['["local","other-chat"]'] = 30;
    saveState();
    assert.equal(activeModel().id, 'gpt-6.1-sol');
    assert.equal(activeModel({ threadId: 'current-chat' }).id, 'devin/claude-opus-5-5');
    assert.equal(activeModel({ threadId: 'missing-chat' }).id, null);
    assert.equal(activeModel({ threadId: 'current-chat' }).source, 'thread-state');
  } finally {
    database.close();
    if (originalHome === undefined) delete process.env.CLIPROXY_CODEX_HOME;
    else process.env.CLIPROXY_CODEX_HOME = originalHome;
    if (originalLogs === undefined) delete process.env.CLIPROXY_CODEX_LOGS;
    else process.env.CLIPROXY_CODEX_LOGS = originalLogs;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('navigation events follow A to B and back without activity changes or new messages', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-view-'));
  const originalHome = process.env.CLIPROXY_CODEX_HOME;
  const originalLogs = process.env.CLIPROXY_CODEX_LOGS;
  process.env.CLIPROXY_CODEX_HOME = directory;
  process.env.CLIPROXY_CODEX_LOGS = path.join(directory, 'logs');
  const logDirectory = path.join(directory, 'logs', '2026', '11', '05');
  fs.mkdirSync(logDirectory, { recursive: true });
  const file = path.join(logDirectory, 'codex-desktop-session-1234-t0-i1-100000-0.log');
  const event = (threadId, active = true) => `2026-11-05T15:39:16.768Z info [host-app-server-manager] thread_stream_view_activity_changed active=${active} conversationId=${threadId} resumeState=resumed streamRole=owner\n`;
  const database = new DatabaseSync(path.join(directory, 'state_5.sqlite'));
  try {
    database.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, model TEXT, archived INTEGER)');
    const insert = database.prepare('INSERT INTO threads VALUES (?, ?, 0)');
    insert.run('chat-a', 'gpt-6.1-sol');
    insert.run('chat-b', 'devin/claude-opus-5-5');
    fs.writeFileSync(path.join(directory, '.codex-global-state.json'), JSON.stringify({ 'electron-persisted-atom-state': {
      'thread-user-activity-times-v1': { '["local","chat-a"]': 100 },
      'composer-recent-model-configurations-v1': [{ model: 'gpt-6.1-sol' }]
    } }));
    fs.writeFileSync(file, event('chat-a'));
    assert.equal(activeModel().id, 'gpt-6.1-sol');
    assert.equal(activeModel().source, 'desktop-visible-thread');
    fs.appendFileSync(file, event('chat-a', false) + event('chat-b'));
    assert.equal(activeModel().id, 'devin/claude-opus-5-5');
    database.prepare('UPDATE threads SET model = ? WHERE id = ?').run('gemini-3.8-flash-high', 'chat-b');
    assert.equal(activeModel().id, 'gemini-3.8-flash-high');
    fs.appendFileSync(file, event('chat-b', false) + event('chat-a'));
    assert.equal(activeModel().id, 'gpt-6.1-sol');
    assert.equal(activeModel().threadId, 'chat-a');
    assert.equal(activeModel({ threadId: 'chat-b' }).id, 'gemini-3.8-flash-high');
    fs.appendFileSync(file, event('chat-a', false));
    assert.equal(activeModel().id, null);
    assert.equal(activeModel().source, 'desktop-view-unavailable');
    const partial = event('chat-b');
    fs.appendFileSync(file, partial.slice(0, -1));
    assert.equal(activeModel().id, null);
    fs.appendFileSync(file, '\n');
    assert.equal(activeModel().id, 'gemini-3.8-flash-high');
    fs.writeFileSync(file, event('chat-a'));
    assert.equal(activeModel().id, 'gpt-6.1-sol');
    // A new application session must not inherit the previous session's visible chat.
    const newSessionFile = path.join(logDirectory, 'codex-desktop-new-session-9876-t0-i1-110000-0.log');
    fs.writeFileSync(newSessionFile, '2026-11-05T16:00:00.000Z info startup\n');
    fs.utimesSync(newSessionFile, new Date(Date.now() + 1000), new Date(Date.now() + 1000));
    assert.equal(activeModel().source, 'desktop-active-thread');
    fs.appendFileSync(newSessionFile, event('chat-b'));
    assert.equal(activeModel().id, 'gemini-3.8-flash-high');
  } finally {
    database.close();
    if (originalHome === undefined) delete process.env.CLIPROXY_CODEX_HOME;
    else process.env.CLIPROXY_CODEX_HOME = originalHome;
    if (originalLogs === undefined) delete process.env.CLIPROXY_CODEX_LOGS;
    else process.env.CLIPROXY_CODEX_LOGS = originalLogs;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
