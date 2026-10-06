import { sendTelegram, type TelegramEnv } from "./telegram";
import { DurableObject } from "cloudflare:workers";
import { evaluateEntry, entryOutcome, type EntryPlan } from "./entry";
import { lookupCandidateNews, newsMessage, type NewsEvidence } from "./news";

type ScanEnv = TelegramEnv & { AUTO_SCAN_ENABLED?: string; ENTRY_ALERTS_ENABLED?: string; CMC_API_KEY?: string };
type Followed = { id: number; symbol: string; plan: EntryPlan; notified: boolean; mode: "live" | "paper"; checked_at?: string };
type Point = { timestamp: string; price: number };
class ScanRequestError extends Error {
  constructor(readonly kind: "timeout" | "network" | "http" | "api" | "invalid_response", readonly code?: number) {
    super("Scan data request failed");
  }
}
function usd(quote: any) {
  return Array.isArray(quote) ? quote.find((q: any) => q.symbol === "USD" || q.currency === "USD" || q.name === "USD") : quote?.USD;
}
export function entryAlertsAllowed(at: number): boolean {
  if (!Number.isFinite(at)) return false;
  const hour=Number(new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Paris",hour:"2-digit",hourCycle:"h23"}).format(new Date(at)));
  return hour>=9 && hour<23;
}

export class ObservationScanner extends DurableObject<ScanEnv> {
  private queue: Promise<unknown> = Promise.resolve();
  run(slot: number): Promise<void> {
    const next = this.queue.then(() => this.scan(slot));
    this.queue = next.catch(() => undefined);
    return next;
  }
  private async scan(slot: number) {
    if (this.env.AUTO_SCAN_ENABLED !== "true" || !this.env.CMC_API_KEY
      || !this.env.TELEGRAM_BOT_TOKEN || !/^-?\d+$/.test(this.env.TELEGRAM_CHAT_ID?.trim() ?? "")) return;
    const now = Date.now();
    const mode = this.env.ENTRY_ALERTS_ENABLED === "true" ? "live" : "paper";
    if (Math.abs(now - slot * 900_000) > 900_000) return;
    const lastSlot = await this.ctx.storage.get<number>("slot");
    if (lastSlot !== undefined && lastSlot >= slot) return;
    // Persist before network calls: retries cannot duplicate scans or sends.
    await this.ctx.storage.put("slot", slot);
    let stage: "listings" | "history" | "delivery" = "listings";
    const record = async (details: Record<string, unknown>) => {
      const status = { checked_at: new Date(now).toISOString(), ...details };
      await this.ctx.storage.put("status", status);
      // Controlled fields only: never env, request URLs, messages or upstream error text.
      console.log(JSON.stringify({ event: "observation_scan", ...status }));
    };
    const get = async (path: string) => {
      const signal = AbortSignal.timeout(15_000);
      let response: Response;
      try {
        response = await fetch(`https://pro-api.coinmarketcap.com${path}`, {
          headers: { "X-CMC_PRO_API_KEY": this.env.CMC_API_KEY! }, signal,
        });
      } catch {
        throw new ScanRequestError(signal.aborted ? "timeout" : "network");
      }
      if (!response.ok) throw new ScanRequestError("http", response.status);
      let body: any;
      try { body = await response.json(); }
      catch { throw new ScanRequestError(signal.aborted ? "timeout" : "invalid_response"); }
      // Match the existing CMC tools: v3 may omit status or encode zero as a string.
      const rawCode = body?.status?.error_code;
      if (rawCode !== undefined && rawCode !== null) {
        if ((typeof rawCode !== "number" && typeof rawCode !== "string") || rawCode === "" || (typeof rawCode === "string" && !/^\d+$/.test(rawCode))) throw new ScanRequestError("invalid_response");
        const code = Number(rawCode);
        if (!Number.isSafeInteger(code)) throw new ScanRequestError("invalid_response");
        if (code !== 0) throw new ScanRequestError("api", code);
      }
      if (!body || typeof body !== "object" || body.data === undefined || body.data === null) throw new ScanRequestError("invalid_response");
      return body.data;
    };
    let snapshot:Record<string,unknown> | undefined;
    try {
      const listings = await get("/v3/cryptocurrency/listings/latest?start=1&limit=300&convert=USD&aux=cmc_rank,tags");
      if (!Array.isArray(listings)) throw new ScanRequestError("invalid_response");
      let followed = await this.ctx.storage.get<Followed[]>("entries") ?? [];
      const normalized = listings.map((a: any) => ({ ...a, quote: { USD: usd(a.quote) } }));
      const eligible = normalized.filter((a: any) => {
        const q = a.quote?.USD;
        const updated = Date.parse(q?.last_updated);
        return Number.isInteger(a.id) && a.id > 0 && a.cmc_rank >= 1 && a.cmc_rank <= 300
          && Array.isArray(a.tags) && !a.tags.includes("stablecoin")
          && /^[A-Za-z0-9._-]{1,32}$/.test(a.symbol)
          && Number.isFinite(q?.price) && q.price > 0
          && Number.isFinite(q?.percent_change_1h) && (q.percent_change_1h > 0 || (q.percent_change_24h > 0 && q.percent_change_1h > -1))
          && Number.isFinite(q?.volume_24h) && q.volume_24h >= 5_000_000
          && Number.isFinite(updated) && now - updated >= 0 && now - updated <= 20 * 60_000;
      }).sort((a: any,b: any)=>a.id-b.id);
      // Two priority slots respond to momentum; remaining slots rotate for coverage.
      const cursor = (await this.ctx.storage.get<number>("cursor") ?? 0) % Math.max(eligible.length,1);
      const rotated = eligible.slice(cursor).concat(eligible.slice(0,cursor));
      const candidates = followed.map(f=>normalized.find((a:any)=>a.id===f.id) ?? {id:f.id,symbol:f.symbol,quote:{USD:null}});
      const checked=await this.ctx.storage.get<Record<string,number>>("history_checked") ?? {};
      const radar=await this.ctx.storage.get<Record<string,number>>("radar") ?? {};
      const watched=eligible.filter((a:any)=>radar[a.id] && now-radar[a.id]<4*3600000).sort((a:any,b:any)=>(checked[a.id]??0)-(checked[b.id]??0)).slice(0,1);
      for (const a of watched) if (candidates.length<5 && !candidates.some((x:any)=>x.id===a.id)) candidates.push(a);
      const priority=eligible.filter((a:any)=>now-(checked[a.id]??0)>=30*60000)
        .sort((a:any,b:any)=>b.quote.USD.percent_change_1h-a.quote.USD.percent_change_1h).slice(0,2);
      for (const a of priority) { if (candidates.length>=5) break; if (!candidates.some((x:any)=>x.id===a.id)) candidates.push(a); }
      let rotatedAdded=0;
      for (const a of rotated) { if (candidates.length>=5) break; if (!candidates.some((x:any)=>x.id===a.id)) { candidates.push(a); rotatedAdded++; } }
      await this.ctx.storage.put("cursor",cursor+Math.max(1,rotatedAdded));
      if (!candidates.length) {
        await record({ ok: true, outcome: "no_candidates", universe:normalized.length, eligible:eligible.length, candidates: 0, attempts: 0, sent: 0 });
        return;
      }
      stage = "history";
      // Optional publication requests run alongside CMC history, not after the final quote.
      // A missing/slow source never blocks a price-qualified occasion.
      const newsBatch=Promise.all(candidates.map(async (a:any)=> {
        try { return {id:a.id,evidence:await lookupCandidateNews(this.ctx.storage,a.id,a.symbol,a.name,now)}; }
        catch { return {id:a.id,evidence:{status:"unavailable",checked_at:new Date(now).toISOString()} as NewsEvidence}; }
      }));
      const history = await get(`/v3/cryptocurrency/quotes/historical?id=${candidates.map((a: any) => a.id).join(",")}&convert=USD&interval=15m&time_start=${Math.floor((now - 6 * 3600_000) / 1000)}&time_end=${Math.floor(now / 1000)}`);
      const assets: any[] = Array.isArray(history) ? history : history?.id ? [history] : Object.values(history ?? {});
      const publications=await newsBatch;
      for (const a of candidates) checked[a.id]=now;
      await this.ctx.storage.put("history_checked",Object.fromEntries(Object.entries(checked).filter(([,at])=>now-at<24*3600000)));
      const marketQuote=(id:number)=> {
        const quote=normalized.find((x:any)=>x.id===id)?.quote?.USD;
        const at=Date.parse(quote?.last_updated);
        return Number.isFinite(at) && now-at>=0 && now-at<=20*60000 ? quote : undefined;
      };
      const btc=marketQuote(1), eth=marketQuote(1027);
      const marketHours=normalized.filter((x:any)=>Array.isArray(x.tags) && !x.tags.includes("stablecoin") && marketQuote(x.id) && Number.isFinite(x.quote.USD?.percent_change_1h)).map((x:any)=>x.quote.USD.percent_change_1h).sort((a:number,b:number)=>a-b);
      const middle=Math.floor(marketHours.length/2);
      const marketSummary={btc1h:btc?.percent_change_1h??null,eth1h:eth?.percent_change_1h??null,coverage:marketHours.length,positive:marketHours.filter((x:number)=>x>0).length,negative:marketHours.filter((x:number)=>x<0).length,median1h:marketHours.length?(marketHours.length%2?marketHours[middle]:(marketHours[middle-1]+marketHours[middle])/2):null};
      const decisions:Record<string,unknown>[]=[];
      const evidence:Record<string,unknown>[]=candidates.map((a:any)=> {
        const asset=assets.find(x=>Number(x.id)===a.id);
        const points=(Array.isArray(asset?.quotes)?asset.quotes:[]).map((x:any)=>({timestamp:x.timestamp,price:usd(x.quote)?.price})).slice(-96);
        return {id:a.id,symbol:a.symbol,quote:a.quote?.USD??null,points,news:publications.find(x=>x.id===a.id)!.evidence};
      });
      snapshot={at:new Date(now).toISOString(),mode,universe:normalized.length,eligible:eligible.length,market:marketSummary,assets:evidence,decisions};
      const day = new Date(now).toISOString().slice(0, 10);
      const dailyKey=mode === "live" ? "daily" : "paper_daily";
      const count = await this.ctx.storage.get<{ day: string; count: number }>(dailyKey);
      let sentToday = count?.day === day ? count.count : 0;
      const freshBudget=await this.ctx.storage.get<{day:string;count:number}>("fresh_daily");
      let freshToday=freshBudget?.day===day ? freshBudget.count : 0;
      let attempts = 0;
      let sent = 0;
      stage = "delivery";
      const audit = async (event: Record<string,unknown>) => {
        const items = await this.ctx.storage.get<Record<string,unknown>[]>("entry_audit") ?? [];
        await this.ctx.storage.put("entry_audit",items.concat({at:new Date(now).toISOString(),...event}).slice(-100));
        console.log(JSON.stringify({event:"entry_audit",at:new Date(now).toISOString(),...event}));
      };
      for (const f of followed.filter(f=>f.mode!==mode)) await audit({id:f.id,mode:f.mode,outcome:"mode_changed",plan:f.plan});
      followed=followed.filter(f=>f.mode===mode);
      await this.ctx.storage.put("entries",followed);
      for (const a of candidates) {
        const asset = assets.find(x => Number(x.id) === a.id);
        const points = (Array.isArray(asset?.quotes) ? asset.quotes : []).map((x: any) => ({ timestamp: x.timestamp, price: usd(x.quote)?.price }));
        const q=a.quote?.USD;
        const news=publications.find(x=>x.id===a.id)!.evidence;
        const existing=followed.find(f=>f.id===a.id);
        if (existing) {
          const evaluationTime=Date.now();
          const checkpoint=existing.checked_at ?? existing.plan.quote_at;
          const outcome=entryOutcome({...existing.plan,quote_at:checkpoint},points,q?.price,q?.last_updated,evaluationTime);
          if (!outcome) {
            existing.checked_at=q.last_updated;
            if (evaluationTime>=Date.parse(existing.plan.review_until)) {
              existing.plan.review_until=new Date(evaluationTime+4*3600000).toISOString();
              await audit({id:a.id,mode,outcome:"review_continues",plan:existing.plan});
            }
            await this.ctx.storage.put("entries",followed);
            continue;
          }
          followed=followed.filter(f=>f.id!==a.id);
          // Persist closure before any uncertain send: no duplicate follow-up.
          await this.ctx.storage.put("entries",followed);
          await audit({id:a.id,symbol:existing.symbol,mode:existing.mode,outcome,plan:existing.plan});
          // Outcomes remain in the audit; Telegram receives only the entry.
          continue;
        }
        if (followed.length>=2 || attempts>=2 || sentToday>=10) continue;
        const market=[marketSummary.btc1h,marketSummary.eth1h].filter((x):x is number=>typeof x === "number" && Number.isFinite(x));
        const context={change24h:q?.percent_change_24h,change7d:q?.percent_change_7d,volumeChange24h:q?.volume_change_24h,market1h:market.length===2 ? Math.min(...market) : undefined};
        const decision=evaluateEntry(points,q?.price,q?.last_updated,Date.now(),context);
        const plan=decision.plan;
        if (decision.metrics && Number(decision.metrics.change1h)>0) radar[a.id]=now;
        decisions.push({id:a.id,symbol:a.symbol,points:points.length,history_age_minutes:points.length?Math.round((now-Date.parse(points.at(-1)!.timestamp))/60000):null,pattern:plan?.pattern??null,qualified:!!plan,reason:decision.reason,metrics:decision.metrics,context,news_status:news.status,news_source:news.source??null});
        if (!plan) continue;
        // Keep overnight analysis/radar, but never queue an entry for the morning.
        if (mode === "live" && !entryAlertsAllowed(Date.now())) {
          await audit({id:a.id,mode,outcome:"quiet_hours"}); continue;
        }
        const key = mode === "live" ? `last:${a.id}` : `paper_last:${a.id}`;
        const last = await this.ctx.storage.get<number>(key);
        if (last !== undefined && now - last < 2 * 3600_000) continue;
        const setupKey=`${mode}:setup:${a.id}`;
        const previousSetup=await this.ctx.storage.get<string>(setupKey);
        if (previousSetup===plan.setup_at) { await audit({id:a.id,mode,outcome:"duplicate_setup"}); continue; }
        // Re-read selected quotes immediately before dispatch, after history work.
        if (freshToday>=10) { await audit({id:a.id,mode,outcome:"fresh_quote_budget"}); continue; }
        await this.ctx.storage.put("fresh_daily",{day,count:++freshToday});
        const fresh=await get(`/v3/cryptocurrency/quotes/latest?id=${a.id}&convert=USD`);
        const raw=(Array.isArray(fresh)?fresh: Object.values(fresh ?? {})).find((x:any)=>Number(x.id)===a.id);
        const current=usd((raw as any)?.quote);
        // Re-check changed market/volume context as well as the price.
        const freshContext={...context,change24h:current?.percent_change_24h??context.change24h,change7d:current?.percent_change_7d??context.change7d,volumeChange24h:current?.volume_change_24h??context.volumeChange24h};
        evidence.find(x=>x.id===a.id)!.dispatch_quote=current??null;
        const verified=evaluateEntry(points,current?.price,current?.last_updated,Date.now(),freshContext);
        if (!verified.plan || current.price<plan.entry || current.price>plan.max) {
          await audit({id:a.id,mode,outcome:"pre_send_rejected",reason:verified.reason,price:current?.price??null});
          continue;
        }
        plan.quote_at=current.last_updated;
        plan.observed_at=new Date(Date.now()).toISOString();
        plan.valid_until=new Date(Date.now()+15*60000).toISOString();
        await audit({id:a.id,mode,outcome:"pre_send_verified",quote_at:current.last_updated,price:current.price});
        if (mode === "live" && !entryAlertsAllowed(Date.now())) {
          await audit({id:a.id,mode,outcome:"quiet_hours"}); continue;
        }
        // Reserve before sending, including uncertain deliveries.
        await this.ctx.storage.put({ [key]: now, [setupKey]: plan.setup_at, [dailyKey]: { day, count: ++sentToday } });
        attempts++;
        const entry:Followed={id:a.id,symbol:a.symbol,plan,notified:false,mode};
        followed.push(entry);
        await this.ctx.storage.put("entries",followed);
        await audit({id:a.id,symbol:a.symbol,mode,outcome:"entry",plan});
        const n=(v:number)=>Number(v.toPrecision(8)).toString();
        const when=(iso:string)=>new Intl.DateTimeFormat("fr-FR",{timeZone:"Europe/Paris",dateStyle:"short",timeStyle:"short"}).format(new Date(iso))+" (Paris)";
        const relative=Number.isFinite(current.percent_change_1h) && Number.isFinite(marketSummary.btc1h) && marketSummary.btc1h!==null ? n(current.percent_change_1h-marketSummary.btc1h)+" points vs BTC (variations CMC 1 h)" : "indisponible";
        const message = `🚨 ENTRÉE POTENTIELLE\n\nCrypto : ${a.symbol}\nDonnées : ${when(plan.quote_at)}, CMC / USD\nZone CMC : ${n(plan.min)} – ${n(plan.max)} USD\nObjectif CMC : ${n(plan.target)} USD (+2,55 % depuis le haut de zone)\nPrix maximal acceptable CMC : ${n(plan.max)} USD\nInvalidation : ${n(plan.stop)} USD (${n((1-plan.stop/plan.max)*100)} % sous le haut de zone)\nEntrée valable jusqu’à : ${when(plan.valid_until)}\nSuivi : réévaluation silencieuse, sans expiration automatique à 4 h\nMotif : ${plan.pattern === "pullback" ? "Début de reprise après repli ; potentiel mesuré sur historique échantillonné, non garanti." : "Cassure ou continuation locale avec contexte 4 h ; confirmation complète non exigée."}\nRisque principal : prix échantillonnés ; retournement entre deux mesures possible.\n${newsMessage(news)}\nForce relative : ${relative}.\nVolumes courts et cotations Neverless indisponibles.\nAvant achat : vérifier disponibilité et prix achat/vente Neverless ; abandonner hors zone ou si spread > 0,5 %. Objectif estimé 2 % net sous cette hypothèse, non garanti. Prix CMC non exécutables ; aucun achat automatique.`;
        // Storage awaits may cross 23:00. No network send has happened yet: undo
        // this reservation so a fresh morning decision is not treated as a duplicate.
        if (mode === "live" && !entryAlertsAllowed(Date.now())) {
          followed=followed.filter(f=>f!==entry);
          await this.ctx.storage.put("entries",followed);
          await this.ctx.storage.put(dailyKey,{day,count:--sentToday}); attempts--;
          if (last===undefined) await this.ctx.storage.delete(key); else await this.ctx.storage.put(key,last);
          if (previousSetup===undefined) await this.ctx.storage.delete(setupKey); else await this.ctx.storage.put(setupKey,previousSetup);
          await audit({id:a.id,mode,outcome:"quiet_hours"}); continue;
        }
        const delivered = mode === "live" && await sendTelegram(this.env, message);
        entry.notified=delivered;
        await this.ctx.storage.put("entries",followed);
        await audit({id:a.id,mode,outcome:"entry_delivery",sent:delivered});
        if (delivered) sent++;
      }
      await this.ctx.storage.put("radar",Object.fromEntries(Object.entries(radar).filter(([,at])=>now-at<4*3600000)));
      await record({ mode, universe:normalized.length, market:marketSummary, news_checked:publications.filter(x=>x.evidence.status!=="unsupported").length, eligible:eligible.length, decisions, candidates: candidates.length, attempts, sent, reserved_today: sentToday, fresh_quotes_today:freshToday, ok: mode === "paper" || sent === attempts, outcome: mode === "paper" ? "simulation" : attempts === 0 ? "no_alert" : sent === attempts ? "sent" : "delivery_unconfirmed" });
    } catch (error) {
      if (snapshot) snapshot.failure={stage,kind:error instanceof ScanRequestError?error.kind:"internal"};
      await record({ ok: false, outcome: "data_error", stage, kind: error instanceof ScanRequestError ? error.kind : "internal", ...(error instanceof ScanRequestError && error.code !== undefined ? { code: error.code } : {}) });
    } finally {
      if (snapshot) {
        // Retain actual inputs even when dispatch fails; never reconstruct them from later charts.
        const snapshots=await this.ctx.storage.get<Record<string,unknown>[]>("scan_evidence") ?? [];
        await this.ctx.storage.put("scan_evidence",snapshots.concat(snapshot).slice(-24));
      }
    }
  }
}
