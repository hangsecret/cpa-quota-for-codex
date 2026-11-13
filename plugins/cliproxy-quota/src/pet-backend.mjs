import readline from 'node:readline';
import { activeModel } from './models.mjs';
import { queryQuota } from './quota.mjs';
import { execute } from './server.mjs';
import { groupAccounts } from './presentation.mjs';
import { compactWindows } from './compact.mjs';
import { updater } from './updates.mjs';

let quota;
let quotaError;
let quotaRetryable = false;
function view(args) {
  const focus = args.model ? { id: args.model, label: '手动指定' } : activeModel();
  const groups = groupAccounts(quota?.accounts || [], focus.id);
  const compact = account => ({ ...account, windows: compactWindows(account, focus.id) });
  return { focus, fetchedAt: quota?.fetchedAt || null, error: quotaError || null, retryable: quotaRetryable, matching: groups.matching.map(compact), others: groups.others.map(compact) };
}
async function dispatch(method, args = {}) {
  if (method === 'check_updates') return updater.check(args.force === true);
  if (method === 'install_update') return updater.install(args.version);
  if (method === 'pet_state') return view(args);
  if (method === 'pet_refresh') {
    try { quota = await queryQuota(args.refresh === true); quotaError = null; quotaRetryable = false; }
    catch (error) { quotaError = error.message; quotaRetryable = error.retryable === true; }
    return view(args);
  }
  if (['get_console_settings', 'save_console_settings', 'test_management_connection', 'list_models', 'fetch_models', 'update_model'].includes(method)) return execute(method, args);
  throw new Error('未知桌面面板操作。');
}
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', async line => {
  let request;
  try {
    if (line.length > 1024 * 1024) return;
    request = JSON.parse(line);
    const result = await dispatch(request.method, request.args);
    process.stdout.write(JSON.stringify({ id: request.id, result }) + '\n');
  } catch (error) { process.stdout.write(JSON.stringify({ id: request?.id, error: error.message }) + '\n'); }
});
