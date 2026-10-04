const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function setup(enabled = true, live = true) {
  const now = Date.now();
  const storage = new Map(); const calls = []; const messages = []; const logs = [];
  const prices = [98,97,100,102,98,101,104,103,102,101,100,100.5];
  const points = prices.map((price, i) => ({ timestamp: new Date(now - (11-i)*900000).toISOString(), price }));
  const ctx = { storage: { get: async key => storage.get(key), put: async (key, value) => {
    if (typeof key === 'string') storage.set(key, value); else Object.entries(key).forEach(([k,v])=>storage.set(k,v));
  } } };
  const env = { AUTO_SCAN_ENABLED: enabled ? 'true' : undefined, ENTRY_ALERTS_ENABLED: live ? 'true' : undefined, CMC_API_KEY: 'fake', TELEGRAM_BOT_TOKEN: 'fake', TELEGRAM_CHAT_ID: '1' };
  const listing = { id: 1, symbol: 'BTC', cmc_rank: 1, tags: [], quote: { USD: { price: 100.5, percent_change_1h: 2, volume_change_24h: 20, volume_24h: 10000000, last_updated: new Date(now).toISOString() } } };
  const context = { exports: {}, Date, AbortSignal, Number, Object, Error, Promise,
    console: { log: text => logs.push(JSON.parse(text)) },
    DurableObject: class { constructor(ctx, env) { this.ctx = ctx; this.env = env; } },
    sendTelegram: async (env, text) => { messages.push(text); return true; },
    fetch: async url => { calls.push(url); return { ok: true, json: async () => ({ status: {error_code:0}, data: url.includes('listings') ? [listing] : { 1: { id: 1, quotes: points.map(x => ({ timestamp:x.timestamp, quote:{USD:{price:x.price}} })) } } }) }; },
  };
  const source = (fs.readFileSync('src/entry.ts','utf8')+'\n'+fs.readFileSync('src/observation.ts','utf8')).replace(/^import .*;\r?\n/gm,'');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
  return { ...context.exports, scanner: new context.exports.ObservationScanner(ctx, env), now, storage, calls, messages, points, listing, logs,
    mapResponse: transform => { const original = context.fetch; context.fetch = async url => { const response = await original(url); const body = await response.json(); return { ...response, json: async () => transform(body) }; }; },
    setFetch: fetch => { context.fetch = fetch; }, setSignal: signal => { context.AbortSignal = { timeout: () => signal }; },
    restart: () => new context.exports.ObservationScanner(ctx, env), failSend: () => { context.sendTelegram = async () => false; } };
}
test('entry rejects stale/chased prices, broken history and insufficient target room', () => {
  const s=setup(), at=new Date(s.now).toISOString();
  const plan=s.entryPlan(s.points,100.5,at,s.now); assert.ok(plan);
  assert.ok((plan.target/plan.max)*(1-0.005)-1>=0.02);
  assert.equal(s.entryPlan(s.points,102,at,s.now),null);
  assert.equal(s.entryPlan(s.points,100.5,at,s.now+6*60000),null);
  const p=s.points.map(x=>({...x})); p[5].timestamp=p[4].timestamp;
  assert.equal(s.entryPlan(p,100.5,at,s.now),null);
  const small=s.points.map(x=>({...x,price:Math.min(x.price,102)}));
  assert.equal(s.entryPlan(small,100.5,at,s.now),null);
});
test('delayed samples allow a bounded live move, but not a chased or falling entry', () => {
  const s=setup(), points=s.points.map(x=>({...x,timestamp:new Date(Date.parse(x.timestamp)-15*60000).toISOString()}));
  const at=new Date(s.now).toISOString();
  assert.ok(s.entryPlan(points,100.9,at,s.now));
  assert.equal(s.entryPlan(points,101.4,at,s.now),null);
  assert.equal(s.entryPlan(points,100.1,at,s.now),null);
});
test('early consolidation breakout qualifies independently of pullback target room', () => {
  const s=setup(), prices=[98,97,100,102,98,101,103,101.5,101,102,101.3,102.3];
  const points=s.points.map((x,i)=>({...x,price:prices[i]})),at=new Date(s.now).toISOString();
  const plan=s.entryPlan(points,102.3,at,s.now);
  assert.ok(plan); assert.equal(plan.pattern,'breakout');
  assert.equal(s.entryPlan(points,103.5,at,s.now),null);
  const flat=points.map(x=>({...x,price:102})); assert.equal(s.entryPlan(flat,102,at,s.now),null);
});
test('momentum candidates receive priority without increasing the history request size', async () => {
  const s=setup();
  s.mapResponse(body=>Array.isArray(body.data)?{...body,data:Array.from({length:20},(_,i)=>({...s.listing,id:i+1,symbol:'X'+i,quote:{USD:{...s.listing.quote.USD,percent_change_1h:(i+1)/10}}}))}:body);
  await s.scanner.run(Math.floor(s.now/900000));
  const url=new URL(s.calls[1]); const ids=url.searchParams.get('id').split(',');
  assert.equal(ids.length,5); assert.deepEqual(ids.slice(0,2),['20','19']);
  assert.equal(s.storage.get('status').eligible,20);
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

test('diagnostics distinguish no candidates and confirmed or uncertain Telegram delivery', async () => {
  const empty=setup(); empty.listing.tags=['stablecoin']; await empty.scanner.run(Math.floor(empty.now/900000));
  assert.equal(empty.storage.get('status').outcome,'no_candidates');
  const good=setup(); await good.scanner.run(Math.floor(good.now/900000));
  assert.equal(good.storage.get('status').sent,1); assert.equal(good.storage.get('status').outcome,'sent');
  const bad=setup(); bad.failSend(); await bad.scanner.run(Math.floor(bad.now/900000));
  assert.equal(bad.storage.get('status').sent,0); assert.equal(bad.storage.get('status').ok,false);
  assert.equal(bad.storage.get('status').outcome,'delivery_unconfirmed');
});

test('failed data requests record stage and controlled codes without leaking error text', async () => {
  for (const kind of ['timeout','network','http','api','invalid_response']) {
    const s=setup(); s.setSignal({aborted:kind==='timeout'});
    s.setFetch(async () => {
      if (kind==='timeout' || kind==='network') throw new Error('SECRET_UPSTREAM_URL_AND_TOKEN');
      if (kind==='http') return {ok:false,status:429};
      if (kind==='invalid_response') return {ok:true,json:async()=>{throw new Error('SECRET_RESPONSE');}};
      return {ok:true,json:async()=>({status:{error_code:1006,error_message:'SECRET_RESPONSE'}})};
    });
    await s.scanner.run(Math.floor(s.now/900000));
    const status=s.storage.get('status');
    assert.equal(status.ok,false); assert.equal(status.stage,'listings'); assert.equal(status.kind,kind);
    if (kind==='http') assert.equal(status.code,429);
    if (kind==='api') assert.equal(status.code,1006);
    assert.equal(JSON.stringify(s.logs).includes('SECRET'),false);
    assert.equal(s.messages.length,0);
  }
});

test('CMC status compatibility accepts numeric/string zero and absent status with valid data', async () => {
  for (const shape of ['numeric','string','absent']) {
    const s=setup(); s.mapResponse(body => {
      if (shape==='string') body.status.error_code='0';
      if (shape==='absent') delete body.status;
      return body;
    });
    await s.scanner.run(Math.floor(s.now/900000));
    assert.equal(s.messages.length,1); assert.equal(s.storage.get('status').outcome,'sent');
  }
});

test('CMC nonzero string codes and malformed success bodies fail closed', async () => {
  for (const raw of ['1006','garbage','',true,{},-1]) {
    const s=setup(); s.mapResponse(body => ({...body,status:{error_code:raw}}));
    await s.scanner.run(Math.floor(s.now/900000));
    assert.equal(s.messages.length,0); assert.equal(s.storage.get('status').ok,false);
    if (raw==='1006') assert.equal(s.storage.get('status').code,1006);
  }
  const missing=setup(); missing.mapResponse(()=>({})); await missing.scanner.run(Math.floor(missing.now/900000));
  assert.equal(missing.storage.get('status').kind,'invalid_response'); assert.equal(missing.messages.length,0);
});

test('paper mode persists audit and follows opportunities without Telegram messages', async () => {
  const s=setup(true,false); await s.scanner.run(Math.floor(s.now/900000));
  assert.equal(s.messages.length,0); assert.equal(s.storage.get('status').outcome,'simulation');
  assert.equal(s.storage.get('entries').length,1); assert.ok(s.storage.get('entry_audit').length);
});

test('outcomes follow chronological observations, expire at four hours and fail on gaps', () => {
  const s=setup(), at=new Date(s.now).toISOString(), plan=s.entryPlan(s.points,100.5,at,s.now);
  const t=s.now+900000, time=new Date(t).toISOString();
  assert.equal(s.entryOutcome(plan,[{timestamp:time,price:plan.stop-0.1}],plan.target+1,time,t),'invalidated');
  assert.equal(s.entryOutcome(plan,[],plan.target+0.1,time,t),'target');
  assert.equal(s.entryOutcome(plan,[],100.5,new Date(s.now+3600000).toISOString(),s.now+3600000),'data_unavailable');
  const future=Array.from({length:16},(_,i)=>({timestamp:new Date(s.now+(i+1)*900000).toISOString(),price:100.5}));
  assert.equal(s.entryOutcome(plan,future,100.5,future[15].timestamp,s.now+4*3600000),'expired');
});

test('active opportunities remain followed after leaving screening and close only once', async () => {
  const s=setup(), slot=Math.floor(s.now/900000); await s.scanner.run(slot);
  const f=s.storage.get('entries')[0]; f.plan.stop=101;
  s.listing.quote.USD.percent_change_1h=-2;
  await s.restart().run(slot+1);
  assert.equal(s.messages.length,2); assert.equal(s.storage.get('entries').length,0);
  await s.restart().run(slot+1); assert.equal(s.messages.length,2);
});

