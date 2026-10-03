import { sendTelegram, type TelegramEnv } from "./telegram";
import { DurableObject } from "cloudflare:workers";
import { entryPlan, entryOutcome, type EntryPlan } from "./entry";

type ScanEnv = TelegramEnv & { AUTO_SCAN_ENABLED?: string; ENTRY_ALERTS_ENABLED?: string; CMC_API_KEY?: string };
type Followed = { id: number; symbol: string; plan: EntryPlan; notified: boolean; mode: "live" | "paper" };
type Point = { timestamp: string; price: number };
class ScanRequestError extends Error {
  constructor(readonly kind: "timeout" | "network" | "http" | "api" | "invalid_response", readonly code?: number) {
    super("Scan data request failed");
  }
}
function usd(quote: any) {
  return Array.isArray(quote) ? quote.find((q: any) => q.symbol === "USD" || q.currency === "USD" || q.name === "USD") : quote?.USD;
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
      // Controlled fields only: never env, URLs, messages or upstream error text.
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
          && Number.isFinite(q?.percent_change_1h) && q.percent_change_1h > 0 && q.percent_change_1h <= 4
          && Number.isFinite(q?.volume_24h) && q.volume_24h >= 5_000_000
          && Number.isFinite(updated) && now - updated >= 0 && now - updated <= 20 * 60_000;
      }).sort((a: any,b: any)=>a.id-b.id);
      // Rotate the eligible universe rather than repeatedly sampling only winners.
      const cursor = (await this.ctx.storage.get<number>("cursor") ?? 0) % Math.max(eligible.length,1);
      const rotated = eligible.slice(cursor).concat(eligible.slice(0,cursor));
      const candidates = followed.map(f=>normalized.find((a:any)=>a.id===f.id) ?? {id:f.id,symbol:f.symbol,quote:{USD:null}});
      for (const a of rotated) { if (candidates.length>=5) break; if (!candidates.some((x:any)=>x.id===a.id)) candidates.push(a); }
      await this.ctx.storage.put("cursor",cursor+Math.max(1,5-followed.length));
      if (!candidates.length) {
        await record({ ok: true, outcome: "no_candidates", candidates: 0, attempts: 0, sent: 0 });
        return;
      }
      stage = "history";
      const history = await get(`/v3/cryptocurrency/quotes/historical?id=${candidates.map((a: any) => a.id).join(",")}&convert=USD&interval=15m&time_start=${Math.floor((now - 4 * 3600_000) / 1000)}&time_end=${Math.floor(now / 1000)}`);
      const assets: any[] = Array.isArray(history) ? history : history?.id ? [history] : Object.values(history ?? {});
      const day = new Date(now).toISOString().slice(0, 10);
      const dailyKey=mode === "live" ? "daily" : "paper_daily";
      const count = await this.ctx.storage.get<{ day: string; count: number }>(dailyKey);
      let sentToday = count?.day === day ? count.count : 0;
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
        const existing=followed.find(f=>f.id===a.id);
        if (existing) {
          const outcome=entryOutcome(existing.plan,points,q?.price,q?.last_updated,now);
          if (!outcome) continue;
          followed=followed.filter(f=>f.id!==a.id);
          // Persist closure before any uncertain send: no duplicate follow-up.
          await this.ctx.storage.put("entries",followed);
          await audit({id:a.id,symbol:existing.symbol,mode:existing.mode,outcome,plan:existing.plan});
          if (existing.notified) {
            attempts++;
            const result=await sendTelegram(this.env,`ℹ️ FIN DU SIGNAL\nCrypto : ${existing.symbol}\nStatut : ${outcome === "invalidated" ? "INVALIDÉ" : outcome === "target" ? "OBJECTIF OBSERVÉ" : outcome === "expired" ? "EXPIRÉ (4 h)" : "SUIVI INDISPONIBLE"}\nSignal du ${existing.plan.observed_at}\nConstat sur prix CMC échantillonnés ; aucun ordre exécuté ni gain net confirmé.`);
            if (result) sent++;
            await audit({id:a.id,outcome:"closure_delivery",sent:result});
          }
          continue;
        }
        if (followed.length>=2 || attempts>=2 || sentToday>=10) continue;
        const plan=entryPlan(points,q?.price,q?.last_updated,Date.now());
        if (!plan) continue;
        const key = mode === "live" ? `last:${a.id}` : `paper_last:${a.id}`;
        const last = await this.ctx.storage.get<number>(key);
        if (last !== undefined && now - last < 2 * 3600_000) continue;
        // Reserve cooldown and daily budget even on uncertain delivery.
        await this.ctx.storage.put({ [key]: now, [dailyKey]: { day, count: ++sentToday } });
        attempts++;
        const entry:Followed={id:a.id,symbol:a.symbol,plan,notified:false,mode};
        followed.push(entry);
        await this.ctx.storage.put("entries",followed);
        await audit({id:a.id,symbol:a.symbol,mode,outcome:"entry",plan});
        const n=(v:number)=>Number(v.toPrecision(8)).toString();
        const when=(iso:string)=>new Intl.DateTimeFormat("fr-FR",{timeZone:"Europe/Paris",dateStyle:"short",timeStyle:"short"}).format(new Date(iso))+" (Paris)";
        const delivered = mode === "live" && await sendTelegram(this.env, `🚨 ENTRÉE POTENTIELLE\n\nCrypto : ${a.symbol}\nZone CMC : ${n(plan.min)} – ${n(plan.max)} USD\nObjectif CMC : ${n(plan.target)} USD (+2,55 % depuis le haut de zone)\nInvalidation : ${n(plan.stop)} USD (−2 % depuis le haut de zone)\nEntrée valable jusqu’à : ${when(plan.valid_until)}\nSuivi : 4 h maximum\nMotif : Repli sur creux ascendant, début de reprise et marge avant le sommet récent.\nAvant achat : vérifier disponibilité et prix achat/vente Neverless ; abandonner hors zone ou si spread > 0,5 %. Objectif estimé 2 % net sous cette hypothèse, non garanti. Prix CMC non exécutables ; aucun achat automatique.`);
        entry.notified=delivered;
        await this.ctx.storage.put("entries",followed);
        await audit({id:a.id,mode,outcome:"entry_delivery",sent:delivered});
        if (delivered) sent++;
      }
      await record({ mode, candidates: candidates.length, attempts, sent, reserved_today: sentToday, ok: mode === "paper" || sent === attempts, outcome: mode === "paper" ? "simulation" : attempts === 0 ? "no_alert" : sent === attempts ? "sent" : "delivery_unconfirmed" });
    } catch (error) {
      await record({ ok: false, outcome: "data_error", stage, kind: error instanceof ScanRequestError ? error.kind : "internal", ...(error instanceof ScanRequestError && error.code !== undefined ? { code: error.code } : {}) });
    }
  }
}
