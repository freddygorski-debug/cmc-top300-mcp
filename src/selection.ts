type ListingObservation = { price: number; at: number; delta: number | null };
export function selectEntryCandidates(assets: any[], previous: Record<string,ListingObservation>, _radar: Record<string,number>, cursor: number, now: number) {
  const observations:Record<string,ListingObservation>={}, rows:Record<string,unknown>[]=[], eligible:any[]=[];
  for (const a of assets) {
    const q=a.quote?.USD, at=Date.parse(q?.last_updated), old=previous[a.id];
    const valid=Number.isInteger(a.id) && a.id>0 && a.cmc_rank>=1 && a.cmc_rank<=300
      && Array.isArray(a.tags) && !a.tags.includes("stablecoin") && /^[A-Za-z0-9._-]{1,32}$/.test(a.symbol)
      && Number.isFinite(q?.price) && q.price>0 && Number.isFinite(q?.volume_24h) && q.volume_24h>=5_000_000
      && Number.isFinite(at) && now-at>=0 && now-at<=20*60000;
    const comparable=valid && old && at>old.at && at-old.at<=20*60000;
    const delta=comparable?q.price/old.price-1:null;
    if (valid) { observations[a.id]={price:q.price,at,delta}; eligible.push(a); }
    rows.push({id:a.id,symbol:a.symbol,eligible:valid,recent_change:delta,selection:valid?"not_selected_capacity":"listing_filter"});
  }
  eligible.sort((a,b)=>a.id-b.id);
  const chosen:any[]=[], add=(a:any,reason:string)=> {
    if (!a || chosen.length>=10 || chosen.some(x=>x.id===a.id)) return false;
    chosen.push(a); const row=rows.find(x=>x.id===a.id); if (row) row.selection=reason; return true;
  };
  // Four rotating places guarantee exploration instead of a strongest-hour monopoly.
  const start=cursor%Math.max(1,eligible.length), rotated=eligible.slice(start).concat(eligible.slice(0,start));
  let explored=0, advanced=0;
  for (const a of rotated) { advanced++; if (add(a,"rotation")) explored++; if (explored>=4) break; }
  // Listing-to-listing recovery is a priority hint, never a validated entry or candle.
  const early=eligible.filter(a=>observations[a.id].delta!==null && observations[a.id].delta!>0)
    .sort((a,b)=> {
      const rank=(x:any)=>observations[x.id].delta!>0.01?2:previous[x.id]?.delta!==null && previous[x.id]?.delta!<0?0:1;
      return rank(a)-rank(b) || observations[b.id].delta!-observations[a.id].delta! || a.id-b.id;
    });
  for (const a of early) { if (chosen.length>=8) break; add(a,"recent_recovery_priority"); }
  // Two places explore a small move after a declining listing. This is only a
  // stabilisation hint, not a confirmed base or an instruction to notify.
  // Old radar membership no longer grants a slot ahead of a fresh occasion.
  const bases=eligible.filter(a=>observations[a.id].delta!==null && Math.abs(observations[a.id].delta!)<=.002
    && previous[a.id]?.delta!==null && previous[a.id]?.delta!<0)
    .sort((a,b)=>Math.abs(observations[a.id].delta!)-Math.abs(observations[b.id].delta!) || a.id-b.id);
  for (const a of bases) add(a,"recent_stabilisation_hint");
  for (const a of rotated) add(a,"rotation_fill");
  return {candidates:chosen,eligible,observations,selection:rows,nextCursor:cursor+Math.max(1,advanced),newCandidates:chosen.length};
}
