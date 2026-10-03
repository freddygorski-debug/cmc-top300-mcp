// Provisional sampled-price rule, evaluated only at the latest available point.
// CMC prices cannot establish Neverless availability or executable net returns.
export type EntryPoint = { timestamp: string; price: number };
export type EntryPlan = { version: "entry-v1"; observed_at: string; quote_at: string; entry: number; min: number; max: number; target: number; stop: number; valid_until: string; review_until: string };
export const ENTRY_POLICY = { gross: 0.0255, spread: 0.005, loss: 0.02, hours: 4, validityMinutes: 15 } as const;
export function entryPlan(points: EntryPoint[], live: number, liveAt: string, now: number): EntryPlan | null {
  if (points.length < 12 || !Number.isFinite(live) || live <= 0) return null;
  const p = points.slice(-12);
  const times = p.map(x => Date.parse(x.timestamp));
  if (p.some(x => !Number.isFinite(x.price) || x.price <= 0) || times.some(t => !Number.isFinite(t))) return null;
  if (times.slice(1).some((t,i) => Math.abs(t-times[i]-900000)>60000)) return null;
  if (now-times[11]>20*60000 || now<times[11]) return null;
  const currentAt = Date.parse(liveAt);
  if (!Number.isFinite(currentAt) || now-currentAt>5*60000 || currentAt>now || currentAt<times[11]) return null;
  const low=p[10].price, last=p[11].price;
  const recovery=last/low-1;
  if (!(low<p[9].price && recovery>=0.002 && recovery<=0.008)) return null;
  const troughs=p.slice(1,9).map((x,i)=>({i:i+1,price:x.price})).filter(x=>x.price<p[x.i-1].price && x.price<p[x.i+1].price);
  if (!troughs.length || low<=troughs[troughs.length-1].price) return null;
  // A rising sampled support, followed by a pullback and an initial recovery.
  const priorHigh=Math.max(...p.slice(3,10).map(x=>x.price));
  if (priorHigh/low-1<0.03 || priorHigh/low-1>0.08) return null;
  // Abandon a stale/chased entry, even when the historical shape qualified.
  if (live/last-1>0.003 || live<last*0.999) return null;
  const min=live*0.9985, max=live*1.0015;
  const target=max*(1+ENTRY_POLICY.gross), stop=max*(1-ENTRY_POLICY.loss);
  if (target>priorHigh || stop>=low*0.998 || stop>=min) return null;
  return {version:"entry-v1",observed_at:new Date(now).toISOString(),quote_at:liveAt,entry:live,min,max,target,stop,
    valid_until:new Date(now+ENTRY_POLICY.validityMinutes*60000).toISOString(),review_until:new Date(now+ENTRY_POLICY.hours*3600000).toISOString()};
}
export function entryOutcome(plan: EntryPlan, points: EntryPoint[], live: number, liveAt: string, now: number): "target" | "invalidated" | "expired" | "data_unavailable" | null {
  const from=Date.parse(plan.quote_at), until=Date.parse(plan.review_until);
  // Reject gaps: a sampled path cannot establish which threshold was hit first.
  const p=points.filter(x=>Date.parse(x.timestamp)>from && Date.parse(x.timestamp)<=Math.min(now,until));
  let previous=from;
  for (const x of p) {
    const t=Date.parse(x.timestamp);
    if (!Number.isFinite(t) || t<=previous || t-previous>16*60000 || !Number.isFinite(x.price) || x.price<=0) return "data_unavailable";
    previous=t;
    if (x.price<=plan.stop) return "invalidated";
    if (x.price>=plan.target) return "target";
  }
  const t=Date.parse(liveAt);
  if (!Number.isFinite(t) || t<previous || now-t>5*60000 || t>now || !Number.isFinite(live) || live<=0 || t-previous>20*60000) return "data_unavailable";
  if (t<=until && live<=plan.stop) return "invalidated";
  if (t<=until && live>=plan.target) return "target";
  return now>=until ? "expired" : null;
}
