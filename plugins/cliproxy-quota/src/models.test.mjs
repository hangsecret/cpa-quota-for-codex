import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { listModels, updateModel, activeModel } from './models.mjs';

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
