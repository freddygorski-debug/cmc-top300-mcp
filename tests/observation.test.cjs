const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function setup(enabled = true) {
  const now = Math.floor(Date.now() / 900000) * 900000;
  const storage = new Map(); const calls = []; const messages = [];
  const prices = [10, 8, 11, 10, 9, 11, 10, 12, 13];
  const points = prices.map((price, i) => ({ timestamp: new Date(now - (8-i)*900000).toISOString(), price }));
  const ctx = { storage: { get: async key => storage.get(key), put: async (key, value) => {
    if (typeof key === 'string') storage.set(key, value); else Object.entries(key).forEach(([k,v])=>storage.set(k,v));
  } } };
  const env = { AUTO_SCAN_ENABLED: enabled ? 'true' : undefined, CMC_API_KEY: 'fake', TELEGRAM_BOT_TOKEN: 'fake', TELEGRAM_CHAT_ID: '1' };
  const listing = { id: 1, symbol: 'BTC', cmc_rank: 1, tags: [], quote: { USD: { price: 13, percent_change_1h: 2, volume_change_24h: 20, volume_24h: 10000000, last_updated: new Date(now).toISOString() } } };
  const context = { exports: {}, Date, AbortSignal, Number, Object, Error, Promise,
    DurableObject: class { constructor(ctx, env) { this.ctx = ctx; this.env = env; } },
    sendTelegram: async (env, text) => { messages.push(text); return true; },
    fetch: async url => { calls.push(url); return { ok: true, json: async () => ({ status: {error_code:0}, data: url.includes('listings') ? [listing] : { 1: { id: 1, quotes: points.map(x => ({ timestamp:x.timestamp, quote:{USD:{price:x.price}} })) } } }) }; },
  };
  const source = fs.readFileSync('src/observation.ts','utf8').replace(/^import .*;\r?\n/gm,'');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
  return { ...context.exports, scanner: new context.exports.ObservationScanner(ctx, env), now, storage, calls, messages, points, listing,
    restart: () => new context.exports.ObservationScanner(ctx, env), failSend: () => { context.sendTelegram = async () => false; } };
}
test('confirmation requires two rising intervals, higher trough, freshness and continuous timestamps', () => {
  const s=setup(); assert.equal(s.confirms(s.points,s.now),true);
  assert.equal(s.confirms(s.points,s.now+21*60000),false);
  assert.equal(s.confirms(s.points.slice(1),s.now),false);
  const p=s.points.map(x=>({...x})); p[6].price=7; assert.equal(s.confirms(p,s.now),false);
  p[6].price=10; p[8].price=11; assert.equal(s.confirms(p,s.now),false);
  p[8].price=13; p[4].timestamp=p[3].timestamp; assert.equal(s.confirms(p,s.now),false);
});
test('disabled scanner makes no requests; enabled scanner serializes duplicate cron events and persists cooldown', async () => {
  const off=setup(false); await off.scanner.run(Math.floor(off.now/900000)); assert.equal(off.calls.length,0);
  const s=setup(); const slot=Math.floor(s.now/900000);
  await Promise.all([s.scanner.run(slot),s.scanner.run(slot)]);
  assert.equal(s.calls.length,2); assert.equal(s.messages.length,1);
  await s.scanner.run(slot+1); assert.equal(s.messages.length,1);
  assert.equal(s.storage.get('daily').count,1);
});
test('stablecoins and stale listings never trigger history fetch or messages', async () => {
  const s=setup(); s.listing.tags=['stablecoin']; await s.scanner.run(Math.floor(s.now/900000)); assert.equal(s.calls.length,1); assert.equal(s.messages.length,0);
  const stale=setup(); stale.listing.quote.USD.last_updated=new Date(stale.now-3600000).toISOString(); await stale.scanner.run(Math.floor(stale.now/900000)); assert.equal(stale.calls.length,1);
});
test('daily attempt cap, cooldown after restart and uncertain delivery remain persistent', async () => {
  const capped=setup(); capped.storage.set('daily',{day:new Date(capped.now).toISOString().slice(0,10),count:10});
  await capped.scanner.run(Math.floor(capped.now/900000)); assert.equal(capped.messages.length,0);
  const s=setup(); const slot=Math.floor(s.now/900000); s.failSend(); await s.scanner.run(slot);
  assert.equal(s.storage.get('daily').count,1); assert.ok(s.storage.get('last:1'));
  await s.restart().run(slot+1); assert.equal(s.storage.get('daily').count,1);
});

