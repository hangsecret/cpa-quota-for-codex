import test from 'node:test';
import assert from 'node:assert/strict';
import { compactWindows } from './compact.mjs';

test('compact cards show primary short and long limits with zero and unknown kept distinct', () => {
  const rows = compactWindows({ windows: [
    { label: '代码审查 · 短周期', remainingPercent: 90 },
    { label: '主配额 · 短周期', remainingPercent: 0, resetAt: '2026-11-06T12:00:00Z' }
  ] });
  assert.deepEqual(rows, [
    { label: '短周期', remainingPercent: 0, resetAt: '2026-11-06T12:00:00Z' },
    { label: '长周期', remainingPercent: null, resetAt: null }
  ]);
});
test('daily and weekly limits map to the two compact periods', () => {
  const rows = compactWindows({ windows: [{ label: '每日额度', remainingPercent: 30 }, { label: '每周额度', remainingPercent: 40 }] });
  assert.deepEqual(rows.map(row => [row.label, row.remainingPercent]), [['短周期', 30], ['长周期', 40]]);
});
test('model-specific quotas keep their real labels and select the current model', () => {
  const row = { label: 'gemini-3.8-flash-high', remainingPercent: 75 };
  assert.deepEqual(compactWindows({ windows: [{ label: 'other-model', remainingPercent: 99 }, row] }, row.label), [row]);
});
test('unrelated model buckets and code-review quota cannot replace the requested main quota', () => {
  assert.deepEqual(compactWindows({ provider: 'antigravity', windows: [{ label: 'other-model', remainingPercent: 99 }] }, 'current-model'), []);
  assert.deepEqual(compactWindows({ provider: 'codex', windows: [{ label: '代码审查 · 短周期', remainingPercent: 99 }] }).map(row => row.remainingPercent), [null, null]);
});
