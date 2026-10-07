// Sampled CMC prices, never OHLC candles or executable Neverless quotes.
export type EntryPoint = { timestamp: string; price: number };
export type EntryContext = { change24h?: number; change7d?: number; volumeChange24h?: number; market1h?: number };
export type EntryPlan = { version: "entry-v6"; pattern?: "pullback" | "breakout" | "continuation"; target_basis?: "sampled_resistance" | "prior_leg_projection"; observed_at: string; quote_at: string; entry: number; min: number; max: number; target: number; stop: number; valid_until: string; support?: number; resistance?: number; risk_reward?: number; setup_at?: string };
export const ENTRY_POLICY = { gross: 0.0255, spread: 0.005, loss: 0.02, validityMinutes: 15 } as const;
export type EntryDecision = { plan: EntryPlan | null; reason: string; metrics?: Record<string, number | null> };
export function evaluateEntry(points: EntryPoint[], live: number, liveAt: string, now: number, context: EntryContext = {}, shortPoints?: EntryPoint[]): EntryDecision {
 const reject=(reason:string,metrics?:Record<string,number|null>):EntryDecision=>({plan:null,reason,metrics});
 if(points.length<17 || !Number.isFinite(live) || live<=0)return reject("insufficient_data");
 const p=points.slice(-96),times=p.map(x=>Date.parse(x.timestamp)),quoteAt=Date.parse(liveAt);
 if(p.some(x=>!Number.isFinite(x.price)||x.price<=0)||times.some(x=>!Number.isFinite(x))||times.slice(1).some((t,i)=>Math.abs(t-times[i]-900000)>60000))return reject("invalid_history");
 if(!Number.isFinite(now)||now<times[times.length-1]||now-times[times.length-1]>1200000||!Number.isFinite(quoteAt)||quoteAt>now||now-quoteAt>300000||quoteAt<times[times.length-1])return reject("stale_data");
 let timing=p;
 if(shortPoints!==undefined){
  timing=shortPoints.slice(-7);
  const shortTimes=timing.map(x=>Date.parse(x.timestamp));
  if(timing.length<6 || timing.some(x=>!Number.isFinite(x.price)||x.price<=0) || shortTimes.some(x=>!Number.isFinite(x))
    || shortTimes.slice(1).some((t,i)=>Math.abs(t-shortTimes[i]-300000)>60000))return reject("invalid_short_history");
  if(now<shortTimes[shortTimes.length-1] || now-shortTimes[shortTimes.length-1]>600000 || quoteAt<shortTimes[shortTimes.length-1])return reject("stale_short_history");
 }
 const last=timing[timing.length-1].price;
 // Merge observed prices for levels only. Validate each resolution separately;
 // never fill gaps or manufacture 5-minute samples from 15-minute prices.
 const structure=shortPoints===undefined?p:p.filter(x=>Date.parse(x.timestamp)<Date.parse(timing[0].timestamp)).concat(timing);
 const observed=structure.concat({timestamp:liveAt,price:live});
 const pivots=observed.slice(1,-1).map((x,i)=>({index:i+1,price:x.price,kind:x.price<observed[i].price&&x.price<=observed[i+2].price?"low":x.price>observed[i].price&&x.price>=observed[i+2].price?"high":"none"})).filter(x=>x.kind!=="none");
 // A new confirmed trough starts a new wave. The old hourly floor is only
 // a fallback for a flat base without a confirmed recent trough.
 const recent=timing.slice(-5),floor=Math.min(...recent.map(x=>x.price));
 const trough=pivots.filter(x=>x.kind==="low"&&x.index>=structure.length-4).slice(-1)[0];
 const support=trough?.price??floor,supportIndex=trough?.index??structure.map(x=>x.price).lastIndexOf(floor),supportAt=structure[supportIndex].timestamp;
 const tail=p.slice(-17),returns=tail.slice(1).map((x,i)=>Math.abs(x.price/tail[i].price-1)).sort((a,b)=>a-b),typical=returns[Math.floor(returns.length/2)];
 const advance=live/support-1,ceiling=Math.max(...timing.slice(-5,-1).map(x=>x.price));
 const metrics:Record<string,number|null>={live,last,support,advance,typical,timing_minutes:shortPoints===undefined?15:5,change1h:live/p[p.length-5].price-1,change4h:live/p[p.length-17].price-1,change24h:context.change24h??null,change7d:context.change7d??null,volumeChange24h:context.volumeChange24h??null,market1h:context.market1h??null};
 // 1. A restart, not a falling price. Tolerate a small dip only after a rise.
 if(live<=support)return reject("support_not_recovered",metrics);
 if(live<last && !(live>=last*.9985 && last>timing[timing.length-2].price))return reject("recovery_fading",metrics);
 const breakout=live>ceiling && ceiling/support-1<=.015;
 const pullback=supportIndex>=structure.length-4 && advance>=.0015;
 if(!breakout&&!pullback)return reject("no_entry_setup",metrics);
 // 2. Structural risk: never move the stop down to force qualification.
 const min=live*.9985,max=live*1.0015,target=max*(1+ENTRY_POLICY.gross),stop=support*(1-Math.max(.002,Math.min(.004,typical)));
 if(stop>=min || 1-stop/max>ENTRY_POLICY.loss)return reject("technical_stop_exceeds_risk",metrics);
 // 3. A resistance must have caused a meaningful (1%) sampled retreat.
 const previousLow=pivots.filter(x=>x.kind==="low"&&x.index<supportIndex).slice(-1)[0];
 if(previousLow && support<previousLow.price && Number(metrics.change4h)<0)return reject("broken_recovery_structure",metrics);
 const peaks=pivots.filter(x=>{
  const after=pivots.find(y=>y.kind==="low"&&y.index>x.index);
  const retreat=after?.price??Math.min(...observed.slice(x.index+1).map(y=>y.price));
  return x.kind==="high" && x.price>max && x.price/retreat-1>=.01;
 });
 const resistance=peaks.length?Math.min(...peaks.map(x=>x.price)):undefined;
 if(resistance!==undefined && target>resistance*.998)return reject("insufficient_room_before_resistance",{...metrics,resistance,target});
 const completed=pivots.filter(x=>x.kind==="high"&&x.index<supportIndex).map(high=>{
  const low=pivots.filter(x=>x.kind==="low"&&x.index<high.index).slice(-1)[0];
  const after=pivots.filter(x=>x.kind==="low"&&x.index>high.index&&x.index<=supportIndex).find(x=>high.price/x.price-1>=.005);
  return {high,low,after,amplitude:low?high.price/low.price-1:0};
 }).filter(x=>x.low && x.after && x.after.price>x.low.price && support>=x.after.price);
 const prior=completed.slice(-1)[0],amplitude=prior?.amplitude??0;
 let basis:EntryPlan["target_basis"]="sampled_resistance";
 if(resistance===undefined){
  if(amplitude<ENTRY_POLICY.gross*1.1)return reject("unverified_target_room",{...metrics,amplitude});
  basis="prior_leg_projection";
 }
 // The prior completed wave sets extension when available, not a fixed 1.2%.
 if(amplitude>=ENTRY_POLICY.gross*1.1 && advance>amplitude*.35)return reject("entry_leg_already_advanced",{...metrics,amplitude});
 return {reason:"qualified",metrics,plan:{version:"entry-v6",pattern:pullback?"pullback":"breakout",target_basis:basis,observed_at:new Date(now).toISOString(),quote_at:liveAt,entry:live,min,max,target,stop,support,resistance,risk_reward:(target-max)/(max-stop),setup_at:supportAt,valid_until:new Date(now+ENTRY_POLICY.validityMinutes*60000).toISOString()}};
}
export function entryPlan(points:EntryPoint[],live:number,liveAt:string,now:number,context?:EntryContext):EntryPlan|null {return evaluateEntry(points,live,liveAt,now,context).plan;}
