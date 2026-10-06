const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function setup(enabled = true, live = true, start = Date.parse("2026-10-07T10:00:00Z")) {
  const now = start;
  let clock = start;
  const ClockDate = class extends Date { static now() { return clock; } };
  const storage = new Map(); const calls = []; const messages = []; const logs = [];
  const prices = [98,99,98,100,101,104,99,99,99,99.5,100,99.9,99.8,100,100.1,100,100.5];
  const points = prices.map((price, i) => ({ timestamp: new Date(now - (prices.length-1-i)*900000).toISOString(), price }));
  const ctx = { storage: { get: async key => storage.get(key), delete: async key => storage.delete(key), put: async (key, value) => {
    if (typeof key === 'string') storage.set(key, value); else Object.entries(key).forEach(([k,v])=>storage.set(k,v));
  } } };
  const env = { AUTO_SCAN_ENABLED: enabled ? 'true' : undefined, ENTRY_ALERTS_ENABLED: live ? 'true' : undefined, CMC_API_KEY: 'fake', TELEGRAM_BOT_TOKEN: 'fake', TELEGRAM_CHAT_ID: '1' };
  const listing = { id: 1, symbol: 'BTC', cmc_rank: 1, tags: [], quote: { USD: { price: 100.5, percent_change_1h: 2, volume_change_24h: 20, volume_24h: 10000000, last_updated: new Date(now).toISOString() } } };
  const context = { exports: {}, Date: ClockDate, AbortSignal, Number, Object, Error, Promise,
    Intl, URL, URLSearchParams, TextDecoder, Uint8Array,
    console: { log: text => logs.push(JSON.parse(text)) },
    DurableObject: class { constructor(ctx, env) { this.ctx = ctx; this.env = env; } },
    sendTelegram: async (env, text) => { messages.push(text); return true; },
    fetch: async url => { calls.push(url); return { ok: true, json: async () => ({ status: {error_code:0}, data: url.includes('listings') ? [listing] : url.includes('quotes/latest') ? {1:listing} : { 1: { id: 1, quotes: points.map(x => ({ timestamp:x.timestamp, quote:{USD:{price:x.price}} })) } } }) }; },
  };
  const source = (fs.readFileSync('src/entry.ts','utf8')+'\n'+fs.readFileSync('src/news.ts','utf8')+'\n'+fs.readFileSync('src/observation.ts','utf8')).replace(/^import .*;\r?\n/gm,'');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
  return { ...context.exports, scanner: new context.exports.ObservationScanner(ctx, env), now, storage, calls, messages, points, listing, logs,
    mapResponse: transform => { const original = context.fetch; context.fetch = async url => { const response = await original(url); const body = await response.json(); return { ...response, json: async () => transform(body) }; }; },
    setFetch: fetch => { context.fetch = fetch; }, setSignal: signal => { context.AbortSignal = { timeout: () => signal }; },
    setClock: at => { clock = at; }, setPut: put => { ctx.storage.put=put; }, restart: () => new context.exports.ObservationScanner(ctx, env), failSend: () => { context.sendTelegram = async () => false; } };
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
test('local breakout with nearby resistance is rejected', () => {
  const s=setup(), prices=[98,97,100,102,98,101,103,101.5,101,102,101.3,102.3];
  const points=s.points.slice(-12).map((x,i)=>({...x,price:prices[i]})),at=new Date(s.now).toISOString();
  const plan=s.entryPlan(points,102.3,at,s.now);
  assert.equal(plan,null); // Missing four-hour context cannot establish an entry.
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
  assert.equal(s.calls.length,3); assert.equal(s.messages.length,1);
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
  assert.ok(good.messages[0].includes('ENTR\u00c9E POTENTIELLE')); assert.equal(good.storage.get('status').sent,1); assert.equal(good.storage.get('status').outcome,'sent');
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

test('outcomes follow chronological observations, continue beyond four hours for v3 and fail on gaps', () => {
  const s=setup(), at=new Date(s.now).toISOString(), plan=s.entryPlan(s.points,100.5,at,s.now);
  const t=s.now+900000, time=new Date(t).toISOString();
  assert.equal(s.entryOutcome(plan,[{timestamp:time,price:plan.stop-0.1}],plan.target+1,time,t),'invalidated');
  assert.equal(s.entryOutcome(plan,[],plan.target+0.1,time,t),'target');
  assert.equal(s.entryOutcome(plan,[],100.5,new Date(s.now+3600000).toISOString(),s.now+3600000),'data_unavailable');
  const future=Array.from({length:16},(_,i)=>({timestamp:new Date(s.now+(i+1)*900000).toISOString(),price:100.5}));
  assert.equal(s.entryOutcome(plan,future,100.5,future[15].timestamp,s.now+4*3600000),null);
});

test('active opportunities remain followed after leaving screening and close only once', async () => {
  const s=setup(), slot=Math.floor(s.now/900000); await s.scanner.run(slot);
  const f=s.storage.get('entries')[0]; f.plan.stop=101;
  s.listing.quote.USD.percent_change_1h=-2;
  await s.restart().run(slot+1);
  assert.equal(s.messages.length,1); assert.equal(s.storage.get('entries').length,0);
  await s.restart().run(slot+1); assert.equal(s.messages.length,1);
});


test('v3 explains fading price, weak context and volume instead of notifying', () => {
  const s=setup(), at=new Date(s.now).toISOString();
  assert.equal(s.evaluateEntry(s.points,100.4,at,s.now).reason,'live_price_fading');
  assert.equal(s.evaluateEntry(s.points,100.5,at,s.now,{volumeChange24h:-34}).reason,'declining_rolling_volume');
  assert.equal(s.evaluateEntry(s.points.map((x,i)=>({...x,price:i===0?100.5:x.price})),100.5,at,s.now,{change24h:-4}).reason,'weak_broader_structure');
});
test('strong hourly movers are no longer excluded by the former four-percent cap', async () => {
  const s=setup(); s.listing.quote.USD.percent_change_1h=5.5;
  await s.scanner.run(Math.floor(s.now/900000)); assert.equal(s.storage.get('status').eligible,1);
});
test('quote deterioration immediately before send suppresses entry without reserving a send', async () => {
  const s=setup(); s.mapResponse(body=>body.data?.[1]?.symbol ? {...body,data:{1:{...s.listing,quote:{USD:{...s.listing.quote.USD,price:100.4}}}}}:body);
  await s.scanner.run(Math.floor(s.now/900000));
  assert.equal(s.messages.length,0); assert.equal(s.storage.get('daily'),undefined);
  assert.ok(s.storage.get('entry_audit').some(x=>x.outcome==='pre_send_rejected'));
});
test('checkpoint lets a v3 scenario survive beyond a rolling history window', () => {
  const s=setup(),at=new Date(s.now).toISOString(),plan=s.entryPlan(s.points,100.5,at,s.now);
  const now=s.now+25*3600000,checkpoint=new Date(now-15*60000).toISOString();
  assert.equal(s.entryOutcome({...plan,quote_at:checkpoint},[],100.5,new Date(now).toISOString(),now),null);
});

test('fresh quote budget is persistent even when entries are rejected', async () => {
 const s=setup(); s.storage.set('fresh_daily',{day:new Date(s.now).toISOString().slice(0,10),count:10});
 await s.scanner.run(Math.floor(s.now/900000));
 assert.equal(s.calls.length,2); assert.equal(s.messages.length,0);
 assert.equal(s.storage.get('fresh_daily').count,10);
});

test('same sampled setup does not send again after closure and cooldown', async () => {
 const s=setup(),slot=Math.floor(s.now/900000); await s.scanner.run(slot);
 assert.equal(s.messages.length,1);
 s.storage.set('entries',[]); s.storage.set('last:1',s.now-3*3600000);
 await s.restart().run(slot+1);
 assert.equal(s.messages.length,1);
 assert.ok(s.storage.get('entry_audit').some(x=>x.outcome==='duplicate_setup'));
});

test('optional publication lookup enriches a single entry or fails without blocking it; dispatch quote is last',async()=>{
 for (const available of [true,false]) {
  const s=setup(); s.listing.id=20947; s.listing.symbol='SUI'; let newsSettled=false;
  s.setFetch(async url=>{
   s.calls.push(url);
   if (url.startsWith('https://www.sui.io/')) {
    await Promise.resolve(); newsSettled=true;
    if (!available) throw new Error('SECRET_SOURCE_ERROR');
    return new Response(`<rss><channel><item><title>Network launch</title><link>https://www.sui.io/blog/network-launch</link><pubDate>${new Date(s.now).toISOString()}</pubDate></item></channel></rss>`);
   }
   if (url.includes('quotes/latest')) assert.equal(newsSettled,true);
   const data=url.includes('listings')?[s.listing]:url.includes('quotes/latest')?{20947:s.listing}:{20947:{id:20947,quotes:s.points.map(x=>({timestamp:x.timestamp,quote:{USD:{price:x.price}}}))}};
   return {ok:true,json:async()=>({data})};
  });
  await s.scanner.run(Math.floor(s.now/900000));
  assert.equal(s.messages.length,1); assert.ok(s.calls.at(-1).includes('quotes/latest'));
  assert.ok(s.messages[0].includes(available?'Network launch':'recherche indisponible'));
  assert.equal(JSON.stringify(s.logs).includes('SECRET'),false);
  const evidence=s.storage.get('scan_evidence')[0].assets[0];
  assert.equal(evidence.points.length,17); assert.equal(evidence.dispatch_quote.price,100.5);
  assert.equal(evidence.news.status,available?'recent_publication':'unavailable');
 }
});
test('a fresh deterioration in rolling volume cancels dispatch even at an unchanged price',async()=>{
 const s=setup(); s.mapResponse(body=>body.data?.[1]?.symbol?{...body,data:{1:{...s.listing,quote:{USD:{...s.listing.quote.USD,volume_change_24h:-40}}}}}:body);
 await s.scanner.run(Math.floor(s.now/900000));
 assert.equal(s.messages.length,0); assert.equal(s.storage.get('daily'),undefined);
 assert.ok(s.storage.get('entry_audit').some(x=>x.outcome==='pre_send_rejected' && x.reason==='declining_rolling_volume'));
});
test('evidence snapshots are bounded and distinguish actual history coverage from the universe',async()=>{
 const s=setup();s.storage.set('scan_evidence',Array.from({length:24},(_,i)=>({at:i})));
 await s.scanner.run(Math.floor(s.now/900000));
 const evidence=s.storage.get('scan_evidence');assert.equal(evidence.length,24);
 const latest=evidence.at(-1);assert.equal(latest.universe,1);assert.equal(latest.assets.length,1);
 assert.equal(latest.assets[0].quote.price,100.5);assert.equal(latest.decisions[0].reason,'qualified');
 assert.equal(latest.market.coverage,1);assert.equal(latest.market.positive,1);
 assert.equal(JSON.stringify(latest).includes('fake'),false);
});
test('dispatch network failure preserves the observed inputs without reserving or leaking an entry',async()=>{
 const s=setup();s.setFetch(async url=>{
  if(url.includes('quotes/latest')) throw new Error('SECRET_REQUEST_FAILURE');
  const data=url.includes('listings')?[s.listing]:{1:{id:1,quotes:s.points.map(x=>({timestamp:x.timestamp,quote:{USD:{price:x.price}}}))}};
  return {ok:true,json:async()=>({data})};
 });
 await s.scanner.run(Math.floor(s.now/900000));
 assert.equal(s.messages.length,0);assert.equal(s.storage.get('daily'),undefined);
 const snapshot=s.storage.get('scan_evidence')[0];assert.equal(snapshot.assets[0].points.length,17);
 assert.equal(snapshot.failure.stage,'delivery');assert.equal(snapshot.failure.kind,'network');
 assert.equal(JSON.stringify(s.logs).includes('SECRET'),false);assert.equal(JSON.stringify(snapshot).includes('SECRET'),false);
});
test('Paris alert window includes 09:00 and excludes 23:00 in winter, summer and DST change dates',()=>{
 const s=setup();
 for(const [start,end] of [['2026-01-10T08:00:00Z','2026-01-10T22:00:00Z'],['2026-07-10T07:00:00Z','2026-07-10T21:00:00Z'],['2026-03-29T07:00:00Z','2026-03-29T21:00:00Z'],['2026-10-25T08:00:00Z','2026-10-25T22:00:00Z']]) {
  assert.equal(s.entryAlertsAllowed(Date.parse(start)-1),false);assert.equal(s.entryAlertsAllowed(Date.parse(start)),true);
  assert.equal(s.entryAlertsAllowed(Date.parse(end)-1),true);assert.equal(s.entryAlertsAllowed(Date.parse(end)),false);
 }
 assert.equal(s.entryAlertsAllowed(NaN),false);
});
test('night scan keeps the radar but makes no send reservation, fresh-quote request or queued morning entry',async()=>{
 const s=setup(true,true,Date.parse('2026-10-07T21:15:00Z'));
 await s.scanner.run(Math.floor(s.now/900000));
 assert.equal(s.calls.length,2);assert.equal(s.messages.length,0);assert.equal(s.storage.get('daily'),undefined);
 assert.equal(s.storage.get('fresh_daily'),undefined);assert.equal(s.storage.get('entries').length,0);assert.ok(s.storage.get('radar')[1]);
 const morning=Date.parse('2026-10-08T07:00:00Z'),delta=morning-s.now;s.setClock(morning);
 s.points.forEach(x=>x.timestamp=new Date(Date.parse(x.timestamp)+delta).toISOString());s.listing.quote.USD.last_updated=new Date(morning).toISOString();
 s.listing.quote.USD.price=100.4;await s.restart().run(Math.floor(morning/900000));
 assert.equal(s.messages.length,0); // New price fails: no replay of yesterday's qualified occasion.
});
test('night window does not stop following an existing live scenario',async()=>{
 const s=setup(true,true,Date.parse('2026-10-07T21:15:00Z'));
 const plan=s.entryPlan(s.points,100.5,new Date(s.now).toISOString(),s.now);plan.quote_at=new Date(s.now-900000).toISOString();
 s.storage.set('entries',[{id:1,symbol:'BTC',plan,mode:'live',notified:true}]);
 await s.scanner.run(Math.floor(s.now/900000));assert.equal(s.messages.length,0);assert.equal(s.storage.get('entries').length,1);
 assert.equal(s.storage.get('entries')[0].checked_at,s.listing.quote.USD.last_updated);
});
test('crossing 23:00 during storage writes cancels the unsent reservation and restores previous state',async()=>{
 for(const prior of [false,true]) {
  const s=setup(true,true,Date.parse('2026-10-07T20:59:59.500Z')),old=s.now-3*3600000;
  if(prior){s.storage.set('last:1',old);s.storage.set('live:setup:1','previous');s.storage.set('daily',{day:'2026-10-07',count:3});}
  s.setPut(async(key,value)=>{
   if(typeof key==='string')s.storage.set(key,value);else Object.entries(key).forEach(([k,v])=>s.storage.set(k,v));
   if(key==='entry_audit' && value.at(-1)?.outcome==='entry')s.setClock(Date.parse('2026-10-07T21:00:00Z'));
  });
  await s.scanner.run(Math.floor(s.now/900000));assert.equal(s.messages.length,0);assert.equal(s.storage.get('entries').length,0);
  assert.equal(s.storage.get('daily').count,prior?3:0);assert.equal(s.storage.get('last:1'),prior?old:undefined);
  assert.equal(s.storage.get('live:setup:1'),prior?'previous':undefined);assert.equal(s.storage.get('status').attempts,0);
 }
});
test('a candidate outside the four official sources receives optional press evidence before the final quote',async()=>{
 const s=setup();s.listing.id=6535;s.listing.symbol='NEAR';s.listing.name='NEAR Protocol';let pressDone=false;
 s.setFetch(async url=>{
  s.calls.push(url);
  if(url.startsWith('https://news.google.com/')){pressDone=true;return new Response(`<rss><channel><item><title>NEAR Protocol launches network upgrade</title><link>https://news.google.com/rss/articles/example</link><pubDate>${new Date(s.now).toISOString()}</pubDate><source url="https://www.coindesk.com">CoinDesk</source></item></channel></rss>`);}
  if(url.includes('quotes/latest'))assert.equal(pressDone,true);
  const data=url.includes('listings')?[s.listing]:url.includes('quotes/latest')?{6535:s.listing}:{6535:{id:6535,quotes:s.points.map(x=>({timestamp:x.timestamp,quote:{USD:{price:x.price}}}))}};
  return {ok:true,json:async()=>({data})};
 });
 await s.scanner.run(Math.floor(s.now/900000));assert.equal(s.messages.length,1);
 assert.ok(s.messages[0].includes('CoinDesk'));assert.ok(s.messages[0].includes('contenu non'));
 assert.equal(s.storage.get('scan_evidence')[0].assets[0].news.press_status,'recent_publication');
 assert.ok(s.calls.at(-1).includes('quotes/latest'));
});
test('a scan crossing 23:00 during the fresh quote does not reserve or send an entry',async()=>{
 const s=setup(true,true,Date.parse('2026-10-07T20:59:59.500Z'));
 s.mapResponse(body=>{if(body.data?.[1]?.symbol)s.setClock(Date.parse('2026-10-07T21:00:00Z'));return body;});
 await s.scanner.run(Math.floor(s.now/900000));assert.equal(s.messages.length,0);
 assert.equal(s.storage.get('daily'),undefined);assert.equal(s.storage.get('last:1'),undefined);
 assert.equal(s.storage.get('fresh_daily').count,1);
});
