const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const context={exports:{},Date};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/entry.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const evaluate=context.exports.evaluateEntry,now=Date.parse('2026-10-07T10:00:00Z'),at=new Date(now).toISOString();
const history=prices=>prices.map((price,i)=>({price,timestamp:new Date(now-(prices.length-1-i)*900000).toISOString()}));
const prices=[98,99,98,100,101,104,99,99,99,99.5,100,99.9,99.8,100,100.1,100,100.5];
test('small dip after a rise is allowed inside risk and target bounds, larger fall is rejected',()=>{
 const p=history(prices),d=evaluate(p,100.4,at,now);
 assert.ok(d.plan);assert.equal(d.plan.version,'entry-v6');assert.ok(d.plan.stop<d.plan.min);
 assert.ok(1-d.plan.stop/d.plan.max<=.02);assert.ok((d.plan.target/d.plan.max)*.995-1>=.02);
 assert.equal(evaluate(p,100.2,at,now).reason,'recovery_fading');
 const flat=history(Array(17).fill(100));assert.equal(evaluate(flat,100,at,now).plan,null);
});
test('old negative broad context and declining rolling volume do not veto a supported price scenario',()=>{
 const d=evaluate(history(prices),100.5,at,now,{change24h:-10,change7d:-20,volumeChange24h:-40,market1h:-2});
 assert.ok(d.plan);assert.equal(d.metrics.volumeChange24h,-40);
});
test('a lower-low recovery inside a falling structure is rejected despite apparent target room',()=>{
 const p=history([105,106,105,104,103,102,101,102,103,102,101,100,99,98,97,96,96.3]);
 assert.equal(evaluate(p,96.3,at,now).reason,'broken_recovery_structure');
});
test('current advance alone cannot justify a target above every known peak',()=>{
 const p=history(Array.from({length:17},(_,i)=>100+i*.2));
 assert.equal(evaluate(p,103.3,at,now).reason,'unverified_target_room');
});
test('a small oscillation followed by a larger completed wave is not an automatic resistance',()=>{
 const p=history([98,99,98,100,102,101.8,104,99,99.2,99.5,100,99.9,99.8,100,100.1,100,100.5]);
 const d=evaluate(p,100.5,at,now);assert.ok(d.plan);assert.equal(d.plan.resistance,104);
 const near=p.map(x=>({...x,price:x.price===104?102:x.price}));assert.equal(evaluate(near,100.5,at,now).reason,'insufficient_room_before_resistance');
});
test('freshness and chronology fail closed before any entry decision',()=>{
 const p=history(prices);assert.equal(evaluate(p,100.5,new Date(now+1).toISOString(),now).reason,'stale_data');
 const gap=p.map(x=>({...x}));gap[10].timestamp=gap[9].timestamp;assert.equal(evaluate(gap,100.5,at,now).reason,'invalid_history');
 assert.equal(evaluate(p,100.5,at,now+1200001).reason,'stale_data');
});

test('a newly confirmed higher trough replaces the old hourly floor for a fresh stair entry',()=>{
 const p=history([98,99,98,110,107,103,100,101,102,103,104,104,103,103.5,104.8,104.3,104.6]);
 const d=evaluate(p,104.7,at,now);assert.ok(d.plan);
 assert.equal(d.plan.support,104.3);assert.equal(d.plan.setup_at,p[15].timestamp);
 assert.ok(1-d.plan.stop/d.plan.max<=.02);assert.equal(d.plan.resistance,110);
 // Falling through that new trough must not fall back to the old hourly floor.
 assert.equal(evaluate(p,104.2,at,now).plan,null);
});

test('observed five-minute recovery can replace an outdated falling fifteen-minute comparison',()=>{
 const p=history([98,99,98,110,108,107,106,105,104,104,104,104,104,104,104,103.5,103]).map(x=>({...x,timestamp:new Date(Date.parse(x.timestamp)-900000).toISOString()}));
 const short=[103.5,103.3,103.2,103,100.2,100.6,101].map((price,i)=>({price,timestamp:new Date(now-(6-i)*300000).toISOString()}));
 assert.equal(evaluate(p,101,at,now).plan,null);
 const d=evaluate(p,101,at,now,{},short);assert.ok(d.plan);assert.equal(d.metrics.timing_minutes,5);assert.equal(d.plan.support,100.2);
});

test('missing, future, stale or wrongly-spaced short prices never silently fall back to fifteen minutes',()=>{
 const p=history(prices),short=[100,100,100.1,100.2,100.3,100,100.5].map((price,i)=>({price,timestamp:new Date(now-(6-i)*300000).toISOString()}));
 assert.equal(evaluate(p,100.5,at,now,{},[]).reason,'invalid_short_history');
 const spaced=short.map(x=>({...x}));spaced[3].timestamp=spaced[2].timestamp;
 assert.equal(evaluate(p,100.5,at,now,{},spaced).reason,'invalid_short_history');
 const future=short.map(x=>({...x,timestamp:new Date(Date.parse(x.timestamp)+300000).toISOString()}));
 assert.equal(evaluate(p,100.5,at,now,{},future).reason,'stale_short_history');
 const old=short.map(x=>({...x,timestamp:new Date(Date.parse(x.timestamp)-900000).toISOString()}));
 assert.equal(evaluate(p,100.5,at,now,{},old).reason,'stale_short_history');
});

test('a price now falling on five-minute observations does not qualify on an older rising fifteen-minute pattern',()=>{
 const p=history(prices),short=[100,100.1,100.2,100.3,100.5,100.7,100.6].map((price,i)=>({price,timestamp:new Date(now-(6-i)*300000).toISOString()}));
 assert.equal(evaluate(p,100.3,at,now,{},short).reason,'recovery_fading');
});
