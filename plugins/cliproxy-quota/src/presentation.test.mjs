import test from 'node:test';
import assert from 'node:assert/strict';
import { groupAccounts } from './presentation.mjs';

const accounts = [
  { supplier: 'zane', provider: 'codex', modelDiscovery: 'confirmed', models: ['gpt-6.1-sol', 'zane/gpt-6.1-sol'] },
  { supplier: 'secret', provider: 'codex', modelDiscovery: 'confirmed', models: ['gpt-6.1-sol', 'secret/gpt-6.1-sol'] },
  { supplier: 'devin', provider: 'devin', modelDiscovery: 'confirmed', models: ['devin/claude-opus-5-5'], status: 'error' },
  { supplier: 'unknown', provider: 'codex', modelDiscovery: 'unknown', models: ['gpt-6.1-sol'] }
];
test('all confirmed suppliers for a shared GPT model stay visible separately', () => {
  const result = groupAccounts(accounts, 'gpt-6.1-sol');
  assert.deepEqual(result.matching.map(a => a.supplier), ['zane', 'secret']);
  assert.equal(result.others.length, 2);
});
test('namespaced routes match only the exact backend model and switching clears old priority', () => {
  assert.deepEqual(groupAccounts(accounts, 'secret/gpt-6.1-sol').matching.map(a => a.supplier), ['secret']);
  assert.deepEqual(groupAccounts(accounts, 'devin/claude-opus-5-5').matching.map(a => a.supplier), ['devin']);
  assert.deepEqual(groupAccounts(accounts, 'claude-opus-5-5').matching, []);
  assert.equal(groupAccounts(accounts, null).others.length, 4);
});
