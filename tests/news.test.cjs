const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
function setup(fetchImpl) {
  const values=new Map(),calls=[];
  const context={exports:{},Date,Intl,URL,URLSearchParams,TextDecoder,Uint8Array,AbortSignal,Error,Number,Object,Array,String,Set,
    fetch:async(url,options)=>{calls.push({url,options});return fetchImpl(url,options);}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/news.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
  return {...context.exports,calls,values,context,storage:{get:async key=>values.get(key),put:async(key,value)=>values.set(key,value)}};
}
const date='2026-10-06T10:00:00.000Z',now=Date.parse(date);
const item=(title='Network &amp; update',link='https://blog.ethereum.org/en/2026/10/06/update',published=date)=>`<item><title>${title}</title><link>${link}</link><pubDate>${published}</pubDate></item>`;
const rss=(items)=>`<?xml version="1.0"?><rss version="2.0"><channel>${items}</channel></rss>`;

test('publication cache uses dated allowlisted links and does not claim price causation',async()=>{
  const s=setup(()=>new Response(rss(item('<![CDATA[<b>Network</b> launch]]>'))));
  const first=await s.lookupNews(s.storage,1027,'ETH',now);
  assert.equal(first.status,'recent_publication'); assert.equal(first.publication.title,'Network launch');
  assert.ok(s.newsMessage(first).includes('Lien avec la hausse non')); assert.ok(s.newsMessage(first).includes('https://blog.ethereum.org/'));
  await s.lookupNews(s.storage,1027,'ETH',now+30*60000); assert.equal(s.calls.length,1);
  assert.equal(s.calls[0].options.redirect,'manual');
  assert.equal(s.calls[0].options.headers['X-CMC_PRO_API_KEY'],undefined);
  assert.equal(s.calls[0].options.headers.Authorization,undefined);
});
test('future, old, undated and off-domain publications cannot become recent evidence',async()=>{
  const body=rss(item('Future',undefined,'2026-10-07T00:00:00Z')+item('Old',undefined,'2026-09-20T00:00:00Z')
    +item('Invalid',undefined,'garbage')+item('External','https://evil.example/update')+item('Credentials','https://secret@blog.ethereum.org/en/update')
    +item('Query','https://blog.ethereum.org/en/update?secret=test'));
  const s=setup(()=>new Response(body)), result=await s.lookupNews(s.storage,1027,'ETH',now);
  assert.equal(result.status,'no_recent_publication'); assert.equal(result.inspected,2);
  assert.equal(result.publication,undefined);
  assert.ok(s.newsMessage(result).includes('publications consult')); // Not a claim that no catalyst exists.
});
test('cached publication loses its recent label at 72 hours without a network call',async()=>{
  const s=setup(()=>new Response(rss(item('Old',undefined,new Date(now-71.75*3600000).toISOString()))));
  assert.equal((await s.lookupNews(s.storage,1027,'ETH',now)).status,'recent_publication');
  const expired=await s.lookupNews(s.storage,1027,'ETH',now+30*60000);
  assert.equal(expired.status,'no_recent_publication'); assert.equal(expired.publication,undefined); assert.equal(s.calls.length,1);
});
test('unsupported assets and symbol collisions make no publication requests',async()=>{
  const s=setup(()=>{throw new Error('Should not fetch');});
  assert.equal((await s.lookupNews(s.storage,1027,'NOT_ETH',now)).status,'unsupported');
  assert.equal((await s.lookupNews(s.storage,1,'BTC',now)).status,'unsupported'); assert.equal(s.calls.length,0);
});
test('Filecoin reads at most two allowlisted detail pages and uses publication date, not modification date',async()=>{
  const index=`<script type="application/ld+json">${JSON.stringify({'@graph':[{'@type':'ItemList',itemListElement:[
    {url:'https://evil.example/exfiltrate'},{url:'https://filecoin.io/blog/one'},{url:'https://filecoin.io/blog/two'},{url:'https://filecoin.io/blog/three'}]}]})}</script>`;
  const s=setup(url=>new Response(url.endsWith('/blog')?index:`<script type="application/ld+json">${JSON.stringify({'@type':'BlogPosting',headline:'Official announcement',mainEntityOfPage:url,datePublished:'2026-09-01T00:00:00Z',dateModified:date})}</script>`));
  const result=await s.lookupNews(s.storage,2280,'FIL',now);
  assert.equal(s.calls.length,3); assert.equal(result.status,'no_recent_publication'); assert.equal(result.inspected,2);
  assert.ok(s.calls.every(x=>x.url.startsWith('https://www.filecoin.io/')));
});
test('malformed/oversized feeds, redirects and network errors remain unavailable with controlled failure codes',async()=>{
  for(const fetchImpl of [()=>new Response('<rss><channel>'),()=>new Response('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///secret">]>'+rss(item())),
    ()=>new Response('x'.repeat(1000001)),()=>new Response('',{status:302,headers:{Location:'https://evil.example/'}}),()=>{throw new Error('SECRET_UPSTREAM_URL_AND_TOKEN');}]) {
    const s=setup(fetchImpl), result=await s.lookupNews(s.storage,1027,'ETH',now);
    assert.equal(result.status,'unavailable'); assert.equal(s.calls.length,1); assert.equal(JSON.stringify(result).includes('SECRET'),false);
    await s.lookupNews(s.storage,1027,'ETH',now+15*60000); assert.equal(s.calls.length,1); // Failure is cached too.
  }
});
test('Stacks is labelled as an ecosystem relay rather than a primary announcement author',async()=>{
  const s=setup(()=>new Response(rss(item('Community update','https://www.stacks.co/blog/community-update'))));
  const evidence=await s.lookupNews(s.storage,4847,'STX',now);
  assert.equal(evidence.status,'recent_publication'); assert.equal(evidence.aggregator,true);
  assert.ok(s.newsMessage(evidence).includes('relay')); assert.ok(s.newsMessage(evidence).includes('agr'));
});
test('an aborted source uses one shared bounded request signal and records timeout without upstream details',async()=>{
  const s=setup((url,{signal})=>{assert.equal(signal.aborted,true);throw new Error('SECRET_TIMEOUT');});
  s.context.AbortSignal={timeout:milliseconds=>{assert.equal(milliseconds,3000);return AbortSignal.abort();}};
  const result=await s.lookupNews(s.storage,1027,'ETH',now);
  assert.equal(result.failure,'timeout'); assert.equal(result.status,'unavailable');
  assert.equal(JSON.stringify(result).includes('SECRET'),false);
});
const headline=(title,publisher='CoinDesk',domain='https://www.coindesk.com',released=date)=>`<item><title>${title}</title><link>https://news.google.com/rss/articles/example?oc=5</link><pubDate>${released}</pubDate><source url="${domain}">${publisher}</source></item>`;
test('press search works for assets outside the four-source catalog and labels content as unverified',async()=>{
 const s=setup(()=>new Response(rss(headline('NEAR Protocol launches a network upgrade'))));
 const result=await s.lookupCandidateNews(s.storage,6535,'NEAR','NEAR Protocol',now);
 assert.equal(result.status,'recent_publication');assert.equal(result.official_status,'unsupported');assert.equal(result.press,true);
 assert.equal(result.publication.publisher,'CoinDesk');assert.equal(s.calls.length,1);
 assert.ok(new URL(s.calls[0].url).searchParams.get('q').includes('"NEAR Protocol"'));
 assert.ok(s.newsMessage(result).includes('contenu non'));assert.equal(s.calls[0].options.headers.Authorization,undefined);
 assert.equal(s.calls[0].options.headers['X-CMC_PRO_API_KEY'],undefined);
 await s.lookupCandidateNews(s.storage,6535,'NEAR','NEAR Protocol',now+15*60000);assert.equal(s.calls.length,1);
});
test('press rejects promotional headlines, ticker-only matches and mismatched publisher/domain',()=>{
 const s=setup(()=>{});
 const rows=rss(headline('NEAR Protocol best crypto to buy now')+headline('NEAR hits record, unrelated ticker')
  +headline('NEAR Protocol upgrade','CoinDesk','https://evil.example')+headline('NEAR Protocol upgrade','Unknown','https://www.coindesk.com')
  +headline('NEAR Protocol upgrade','CoinDesk','https://secret@www.coindesk.com')+headline('NEAR Protocol releases new mainnet software'));
 const parsed=s.parseHeadlines(rows,'NEAR Protocol');assert.equal(parsed.inspected,6);assert.equal(parsed.items.length,1);
 assert.ok(parsed.items[0].title.includes('mainnet'));assert.ok(!parsed.items[0].url.includes('?'));
});
test('press distinguishes no recent result from source failure and never substitutes a future or undated article',async()=>{
 const empty=setup(()=>new Response(rss(headline('Raydium upgrade','CoinDesk',undefined,'2026-10-08T00:00:00Z')+headline('Raydium upgrade','CoinDesk',undefined,'invalid'))));
 assert.equal((await empty.lookupHeadlines(empty.storage,8526,'RAY','Raydium',now)).status,'no_recent_publication');
 const failed=setup(()=>{throw new Error('SECRET_SOURCE');});
 const result=await failed.lookupCandidateNews(failed.storage,8526,'RAY','Raydium',now);
 assert.equal(result.status,'unavailable');assert.equal(JSON.stringify(result).includes('SECRET'),false);
 await failed.lookupCandidateNews(failed.storage,8526,'RAY','Raydium',now+15*60000);assert.equal(failed.calls.length,1);
});
