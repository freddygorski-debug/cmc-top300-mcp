const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const ts = require('typescript');
const { z } = require('zod');

// Run the actual Worker routes with only the Cloudflare/MCP imports stubbed.
function setup() {
  const source = fs.readFileSync('src/index.ts', 'utf8').replace(/^import .*;\r?\n/gm, '');
  const calls = [];
  const tools = [];
  let telegramResponse = Response.json({ ok: true });
  const context = {
    exports: {}, z, env: {}, Request, Response, URL, TextEncoder, TextDecoder,
    Uint8Array, AbortSignal, crypto: globalThis.crypto,
    McpServer: class { registerTool(name) { tools.push(name); } },
    createMcpHandler: create => { create(); return () => Response.json({ mcp: true }); },
    fetch: async (...args) => { calls.push(args); if (telegramResponse instanceof Error) throw telegramResponse; return telegramResponse; },
  };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const secret = 'x'.repeat(32);
  const env = { TELEGRAM_TEST_SECRET: secret, TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: '123' };
  const payload = { symbol: 'BTC', status: 'Actif', price: 100, signal: 'Hausse', take_profit: '102 USD', stop_loss: 98, reason: 'Momentum' };
  const request = (body = payload, options = {}) => new Request('https://worker.test/telegram/alert', {
    method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...options,
  });
  return { calls, tools, env, payload, request, run: req => context.exports.default.fetch(req, env, {}), fail: value => { telegramResponse = value; } };
}

test('authenticated alert sends the structured message; CMC tools remain registered', async () => {
  const s = setup();
  assert.deepEqual(s.tools, ['get_cmc_top_300', 'get_cmc_intraday_15m']);
  const response = await s.run(s.request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { ok: true, sent: true });
  assert.equal(JSON.parse(s.calls[0][1].body).text, '🚨 ALERTE CRYPTO\n\nCrypto : BTC\nStatut : Actif\nPrix : 100\nSignal : Hausse\nTP : 102 USD\nSL : 98\nMotif : Momentum');
});

test('invalid requests never send', async () => {
  const s = setup();
  const cases = [
    [s.request(undefined, { method: 'GET', body: undefined }), 405],
    [s.request(undefined, { headers: { 'Content-Type': 'application/json' } }), 401],
    [s.request(undefined, { headers: { Authorization: 'Bearer wrong', 'Content-Type': 'application/json' } }), 401],
    [s.request(undefined, { headers: { Authorization: `Bearer ${s.env.TELEGRAM_TEST_SECRET}` } }), 415],
    [s.request(undefined, { body: '{' }), 400],
    [s.request(null), 400],
    [s.request({ ...s.payload, reason: 'x'.repeat(1001) }), 400],
    [s.request({ ...s.payload, symbol: 'BTC\nSpoof' }), 400],
    [s.request({ ...s.payload, status: '  ' }), 400],
    [s.request({ ...s.payload, price: -1 }), 400],
    [s.request({ ...s.payload, extra: true }), 400],
    [s.request({ symbol: 'BTC' }), 400],
    [s.request(undefined, { body: ' '.repeat(8193) }), 413],
  ];
  for (const [request, expected] of cases) assert.equal((await s.run(request)).status, expected);
  assert.equal(s.calls.length, 0);
  s.env.TELEGRAM_TEST_SECRET = 'short';
  assert.equal((await s.run(s.request())).status, 503);
});

test('Telegram failures are sanitized and test route retains disabled/dry-run/send behavior', async () => {
  const s = setup();
  for (const failure of [Response.json({ ok: false }), new Response('private upstream error', { status: 500 }), new Error('fake-token')]) {
    s.fail(failure);
    const response = await s.run(s.request());
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { ok: false, sent: false });
  }
  const req = suffix => new Request(`https://worker.test/telegram/test${suffix}`, { method: 'POST', headers: { Authorization: `Bearer ${s.env.TELEGRAM_TEST_SECRET}` } });
  assert.equal((await s.run(req(''))).status, 404);
  s.env.TELEGRAM_TEST_ENABLED = 'true';
  assert.deepEqual(await (await s.run(req(''))).json(), { ok: true, dry_run: true, sent: false });
  s.fail(Response.json({ ok: true }));
  assert.equal((await s.run(req('?send=1'))).status, 200);
  s.env.TELEGRAM_CHAT_ID = 'invalid';
  assert.equal((await s.run(s.request())).status, 503);
});
