// CMC samples are prices, not OHLC or executable Neverless quotes.
export type EntryPoint = { timestamp: string; price: number };
export type EntryContext = { change24h?: number; change7d?: number; volumeChange24h?: number; market1h?: number };
export type EntryPlan = { version: "entry-v1" | "entry-v2" | "entry-v3"; pattern?: "pullback" | "breakout" | "continuation"; observed_at: string; quote_at: string; entry: number; min: number; max: number; target: number; stop: number; valid_until: string; review_until: string; support?: number; resistance?: number; risk_reward?: number; setup_at?: string };
export const ENTRY_POLICY = { gross: 0.0255, spread: 0.005, loss: 0.02, hours: 4, validityMinutes: 15 } as const;
export type EntryDecision = { plan: EntryPlan | null; reason: string; metrics?: Record<string, number | null> };
export function evaluateEntry(points: EntryPoint[], live: number, liveAt: string, now: number, context: EntryContext = {}): EntryDecision {
  const reject = (reason: string, metrics?: Record<string, number | null>): EntryDecision => ({ plan: null, reason, metrics });
  if (points.length < 17 || !Number.isFinite(live) || live <= 0) return reject("insufficient_data");
  const p = points.slice(-96), times = p.map(x => Date.parse(x.timestamp));
  if (p.some(x => !Number.isFinite(x.price) || x.price <= 0) || times.some(t => !Number.isFinite(t))
    || times.slice(1).some((t,i) => Math.abs(t-times[i]-900000)>60000)) return reject("invalid_history");
  const quoteAt = Date.parse(liveAt), last = p[p.length-1]!.price;
  if (now-times[times.length-1]! > 20*60000 || now < times[times.length-1]!
    || !Number.isFinite(quoteAt) || now-quoteAt > 5*60000 || quoteAt > now || quoteAt < times[times.length-1]!) return reject("stale_data");
  if (live < last) return reject("live_price_fading", { live, last });
  const hour = p.slice(-5), base = p.slice(-9,-1);
  const ceiling = Math.max(...base.map(x=>x.price)), floor = Math.min(...base.map(x=>x.price));
  const change4h = live/p[p.length-17]!.price-1, change1h = live/hour[0].price-1, range = ceiling/floor-1;
  const tail=p.slice(-17);
  const volatility = tail.slice(1).map((x,i)=>Math.abs(x.price/tail[i].price-1)).sort((a,b)=>a-b);
  const typical = volatility[Math.floor(volatility.length/2)], extension = live/last-1;
  const metrics = { live, last, change1h, change4h, range, typical, extension, change24h: context.change24h ?? null,
    change7d: context.change7d ?? null, volumeChange24h: context.volumeChange24h ?? null, market1h: context.market1h ?? null };
  if (extension > Math.min(0.015,Math.max(0.004,typical*2))) return reject("extended_since_sample",metrics);
  if (change1h <= 0) return reject("no_current_impulse",metrics);
  if (change4h < -0.005 || (context.change24h !== undefined && context.change24h < -3 && change4h < 0.01)) return reject("weak_broader_structure",metrics);
  if (context.volumeChange24h !== undefined && context.volumeChange24h < -20) return reject("declining_rolling_volume",metrics);
  const before = p[p.length-3]!.price, low = p[p.length-2]!.price;
  const pullback = low < before && last > low && low >= p[p.length-9]!.price;
  const breakout = live > ceiling && live/ceiling-1 <= Math.max(0.006,typical*2) && range >= 0.003;
  if (!pullback && !breakout) return reject("no_entry_setup",metrics);
  const support = pullback ? low : floor;
  const min = live*0.9985, max = live*1.0015, target = max*(1+ENTRY_POLICY.gross);
  const stop = support*(1-Math.max(0.002,Math.min(0.004,typical)));
  if (stop >= min || 1-stop/max > ENTRY_POLICY.loss) return reject("technical_stop_exceeds_risk",metrics);
  const peaks = p.slice(1,-2).filter((x,i)=>x.price>p[i].price && x.price>p[i+2].price && x.price>max);
  const resistance = peaks.length ? Math.min(...peaks.map(x=>x.price)) : undefined;
  if (resistance !== undefined && target > resistance*0.998) return reject("insufficient_room_before_resistance",{...metrics,resistance,target});
  // Price discovery uses a provisional prior-impulse projection, not a known resistance.
  if (resistance === undefined && change4h < ENTRY_POLICY.gross) return reject("unverified_target_room",metrics);
  const riskReward = (target-max)/(max-stop);
  const pattern = pullback ? "pullback" : change4h > 0.015 ? "continuation" : "breakout";
  return { reason: "qualified", metrics, plan: { version:"entry-v3",pattern,observed_at:new Date(now).toISOString(),quote_at:liveAt,
    entry:live,min,max,target,stop,support,resistance,risk_reward:riskReward,setup_at:pullback?p[p.length-2].timestamp:base.find(x=>x.price===floor)!.timestamp,
    valid_until:new Date(now+ENTRY_POLICY.validityMinutes*60000).toISOString(),review_until:new Date(now+ENTRY_POLICY.hours*3600000).toISOString() } };
}
export function entryPlan(points: EntryPoint[], live: number, liveAt: string, now: number, context?: EntryContext): EntryPlan | null {
  return evaluateEntry(points,live,liveAt,now,context).plan;
}
export function entryOutcome(plan: EntryPlan, points: EntryPoint[], live: number, liveAt: string, now: number): "target" | "invalidated" | "expired" | "data_unavailable" | null {
  const from=Date.parse(plan.quote_at), until=plan.version === "entry-v3" ? now : Date.parse(plan.review_until);
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
  return plan.version !== "entry-v3" && now>=until ? "expired" : null;
}
