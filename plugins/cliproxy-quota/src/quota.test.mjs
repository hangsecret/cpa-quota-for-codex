import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuota, collectQuota, request, testManagementConnection } from './quota.mjs';

test('Codex zero usage, full usage, and unknown values', () => {
  const result = normalizeQuota({ rate_limit: { primary_window: { used_percent: 0, reset_at: 1800000000 }, secondary_window: { used_percent: 100 } } }, 'codex');
  assert.deepEqual(result.map(row => row.remainingPercent), [100, 0]);
  assert.equal(result[0].resetAt, new Date(1800000000000).toISOString());
  assert.deepEqual(normalizeQuota({ rate_limit: { primary_window: { used_percent: null } } }, 'codex'), []);
});
test('Claude and plugin quotas preserve zero and fractional percentages', () => {
  assert.equal(normalizeQuota({ five_hour: { utilization: 24.5 } }, 'claude')[0].remainingPercent, 75.5);
  assert.equal(normalizeQuota({ groups: [{ buckets: [{ remainingFraction: 0 }] }] }, 'devin')[0].remainingPercent, 0);
});
test('v8 plugin discovery and account errors remain separate', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/credentials')) return Response.json({ files: [{ name: 'devin', provider: 'devin', auth_index: 'a' }, { name: 'unknown', provider: 'custom', auth_index: 'b' }] });
    if (url.endsWith('/plugins')) return Response.json({ plugins: [{ id: 'devin-quota', quota_provider: 'devin', supports_quota: true, enabled: true }] });
    if (url.includes('/credentials/models?')) return Response.json({ models: [{ id: 'devin/claude-opus-5-5' }] });
    return Response.json({ groups: [{ displayName: 'Daily', buckets: [{ remainingFraction: 0.75 }] }] });
  };
  const value = await collectQuota({ baseUrl: 'https://example.com', apiVersion: 'v8' }, 'secret', fetcher);
  assert.equal(value.accounts[0].windows[0].remainingPercent, 75);
  assert.equal(value.accounts[1].status, 'unsupported');
  assert(calls.some(c => c.url.includes('/plugins/devin-quota/quota?auth_index=a')));
  assert.deepEqual(value.accounts[0].models, ['devin/claude-opus-5-5']);
  assert.equal(value.accounts[0].modelDiscovery, 'confirmed');
  assert(!JSON.stringify(value).includes('secret'));
});
test('authentication errors stop further requests', async () => {
  let count = 0;
  await assert.rejects(collectQuota({ baseUrl: 'https://example.com', apiVersion: 'v8' }, 'secret', async () => { count++; return new Response('', { status: 401 }); }), /认证失败/);
  assert.equal(count, 1);
});
test('v0 uses auth-files and api-call with fixed upstream URL', async () => {
  const urls = [];
  const result = await collectQuota({ baseUrl: 'https://example.com', apiVersion: 'v0' }, 'secret', async (url, options) => {
    urls.push(url);
    if (url.endsWith('/auth-files')) return Response.json({ files: [{ name: 'codex', type: 'codex', auth_index: '1' }] });
    if (url.includes('/auth-files/models?')) return Response.json({ models: [{ id: 'gpt-6.1-sol' }, { id: 'secret/gpt-6.1-sol' }] });
    const body = JSON.parse(options.body);
    assert.equal(body.url, 'https://chatgpt.com/backend-api/wham/usage');
    assert.equal(body.header.Authorization, 'Bearer $TOKEN$');
    return Response.json({ status_code: 200, body: JSON.stringify({ rate_limit: { primary_window: { used_percent: 35 } } }) });
  });
  assert.equal(result.accounts[0].windows[0].remainingPercent, 65);
  assert(urls.some(url => url.endsWith('/v0/management/api-call')));
  assert.equal(result.accounts[0].supplier, 'secret');
});
test('Devin quota works without a server plugin and handles percent strings and zero', async () => {
  const result = await collectQuota({ baseUrl: 'https://example.com', apiVersion: 'v8' }, 'secret', async (url, options) => {
    if (url.endsWith('/credentials')) return Response.json({ files: [{ name: 'devin', provider: 'devin', auth_index: 'a' }] });
    if (url.endsWith('/plugins')) return Response.json({ plugins: [] });
    if (url.includes('/credentials/models?')) return Response.json({ models: [{ id: 'devin/claude-opus-5-5' }] });
    const body = JSON.parse(options.body);
    assert.equal(body.url, 'https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus');
    assert.equal(JSON.parse(body.data).metadata.apiKey, '$TOKEN$');
    assert.equal(body.header.Authorization, undefined);
    return Response.json({ status_code: 200, body: { userStatus: { planStatus: { dailyQuotaRemainingPercent: '75', weeklyQuotaRemainingPercent: 0 } } } });
  });
  assert.deepEqual(result.accounts[0].windows.map(w => w.remainingPercent), [75, 0]);
});
test('model discovery failures preserve quotas without claiming model support', async () => {
  const result = await collectQuota({ baseUrl: 'https://example.com', apiVersion: 'v8' }, 'secret', async url => {
    if (url.endsWith('/credentials')) return Response.json({ files: [{ name: 'codex', provider: 'codex', auth_index: 'a' }] });
    if (url.endsWith('/plugins')) return Response.json({ plugins: [] });
    if (url.includes('/credentials/models?')) return new Response('', { status: 404 });
    return Response.json({ status_code: 200, body: { rate_limit: { primary_window: { used_percent: 0 } } } });
  });
  assert.equal(result.accounts[0].windows[0].remainingPercent, 100);
  assert.equal(result.accounts[0].modelDiscovery, 'unknown');
  assert.deepEqual(result.accounts[0].models, []);
});
test('network errors are sanitized and redirects are refused', async () => {
  await assert.rejects(request('https://example.com', 'secret', '/credentials', undefined, async (url, options) => {
    assert.equal(options.redirect, 'error');
    throw new Error('sensitive internal detail');
  }), error => !error.message.includes('sensitive'));
});

test('network diagnostics distinguish DNS, TLS, proxy resets and timeouts without raw errors', async () => {
  for (const [code, expected] of [
    ['ENOTFOUND', /DNS/], ['EAI_AGAIN', /DNS/], ['ECONNREFUSED', /拒绝连接/],
    ['ECONNRESET', /重置/], ['UND_ERR_SOCKET', /提前关闭/],
    ['ETIMEDOUT', /超时/], ['UND_ERR_CONNECT_TIMEOUT', /超时/],
    ['CERT_HAS_EXPIRED', /证书已过期/], ['ERR_TLS_CERT_ALTNAME_INVALID', /域名不匹配/],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', /证书链/],
  ]) {
    await assert.rejects(request('https://example.com', 'test-secret', '/credentials', undefined, async () => {
      throw new TypeError('test-secret', { cause: Object.assign(new Error('test-secret'), { code }) });
    }), error => expected.test(error.message) && error.code === code && !error.message.includes('test-secret')
      && error.retryable === !['CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(code));
  }
  await assert.rejects(request('https://example.com', 'secret', '/credentials', undefined, async () => {
    throw new DOMException('secret', 'TimeoutError');
  }), error => /20 秒/.test(error.message) && error.retryable);
  await assert.rejects(request('https://example.com', 'secret', '/credentials', undefined, async () => {
    throw new TypeError('secret', { cause: new Error('unexpected redirect') });
  }), error => /重定向/.test(error.message) && !error.retryable);
  await assert.rejects(request('https://example.com', 'secret', '/credentials', undefined, async () => ({ ok: true, json: async () => {
    throw new TypeError('secret', { cause: Object.assign(new Error(), { code: 'ECONNRESET' }) });
  } })), /重置/);
});

test('management diagnostics report remote policy and temporary IP bans separately', async () => {
  await assert.rejects(request('https://example.com', 'secret', '/credentials', undefined, async () => Response.json({ error: 'remote management disabled' }, { status: 403 })), /allow-remote/);
  await assert.rejects(request('https://example.com', 'secret', '/credentials', undefined, async () => Response.json({ error: 'IP banned due to too many failed attempts. secret' }, { status: 403 })), error => /临时封禁/.test(error.message) && !error.message.includes('secret'));
  await assert.rejects(request('https://example.com', 'secret', '/credentials', undefined, async () => new Response('<html>secret</html>', { status: 403 })), /HTTP 403/);
  await assert.rejects(request('https://example.com', 'secret', '/credentials', undefined, async () => new Response('', { status: 401 })), error => /管理密钥/.test(error.message) && !error.retryable);
  await assert.rejects(request('https://example.com', 'secret', '/credentials', undefined, async () => new Response('', { status: 503 })), error => error.status === 503 && error.retryable);
});

test('connection test uses one read-only request and returns sanitized diagnostics', async () => {
  const config = { baseUrl: 'https://example.com', apiVersion: 'v8' };
  let calls = 0;
  const ok = await testManagementConnection(config, 'test-secret', async (url, options) => {
    calls++;
    assert.equal(url, 'https://example.com/v8/management/credentials');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    return Response.json({ files: [{ token: 'account-secret' }] });
  });
  assert.equal(calls, 1);
  assert.equal(ok.connected, true);
  assert(!JSON.stringify(ok).includes('secret'));
  const failure = await testManagementConnection(config, 'test-secret', async () => {
    throw new Error('test-secret', { cause: Object.assign(new Error(), { code: 'ENOTFOUND' }) });
  });
  assert.equal(failure.connected, false);
  assert.equal(failure.code, 'ENOTFOUND');
  assert(!JSON.stringify(failure).includes('test-secret'));
  assert.equal((await testManagementConnection(config, 'test-secret', async () => Response.json({ files: [] }, { status: 401 }))).status, 401);
  assert.equal((await testManagementConnection(config, 'test-secret', async () => Response.json({ unrelated: [] }))).connected, false);
  const unsafe = await testManagementConnection({ ...config, baseUrl: 'https://user:test-secret@example.com/' }, 'key', async () => { throw new Error('Should not fetch'); });
  assert.equal(unsafe.endpoint, '');
  assert(!JSON.stringify(unsafe).includes('test-secret'));
});
