import { sendTelegram, type TelegramEnv } from "./telegram";
import { DurableObject } from "cloudflare:workers";

type ScanEnv = TelegramEnv & { AUTO_SCAN_ENABLED?: string; CMC_API_KEY?: string };
type Point = { timestamp: string; price: number };
class ScanRequestError extends Error {
  constructor(readonly kind: "timeout" | "network" | "http" | "api" | "invalid_response", readonly code?: number) {
    super("Scan data request failed");
  }
}
function usd(quote: any) {
  return Array.isArray(quote) ? quote.find((q: any) => q.symbol === "USD" || q.currency === "USD" || q.name === "USD") : quote?.USD;
}
export function confirms(points: Point[], now: number): boolean {
  if (points.length < 9) return false;
  const p = points.slice(-9);
  if (p.some(x => !Number.isFinite(x.price) || x.price <= 0)) return false;
  const times = p.map(x => Date.parse(x.timestamp));
  if (times.some(x => !Number.isFinite(x)) || now - times[8] > 20 * 60_000 || times[8] > now) return false;
  if (times.slice(1).some((t, i) => Math.abs(t - times[i] - 900_000) > 60_000)) return false;
  // Two completed rising intervals and two genuine local troughs.
  if (!(p[8].price > p[7].price && p[7].price > p[6].price)) return false;
  const troughs = p.slice(1, 7).map((x, i) => ({ i: i + 1, price: x.price }))
    .filter(x => x.price < p[x.i - 1].price && x.price < p[x.i + 1].price);
  return troughs.length >= 2 && troughs[troughs.length - 1].price > troughs[troughs.length - 2].price;
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
      if (body.status?.error_code !== 0) throw new ScanRequestError("api", Number.isInteger(body.status?.error_code) ? body.status.error_code : undefined);
      return body.data;
    };
    try {
      const listings = await get("/v3/cryptocurrency/listings/latest?start=1&limit=300&convert=USD&aux=cmc_rank,tags");
      if (!Array.isArray(listings)) throw new ScanRequestError("invalid_response");
      const candidates = listings.map((a: any) => ({ ...a, quote: { USD: usd(a.quote) } })).filter((a: any) => {
        const q = a.quote?.USD;
        const updated = Date.parse(q?.last_updated);
        return Number.isInteger(a.id) && a.id > 0 && a.cmc_rank >= 1 && a.cmc_rank <= 300
          && Array.isArray(a.tags) && !a.tags.includes("stablecoin")
          && /^[A-Za-z0-9._-]{1,32}$/.test(a.symbol)
          && Number.isFinite(q?.price) && q.price > 0
          && Number.isFinite(q?.percent_change_1h) && q.percent_change_1h >= 1
          && Number.isFinite(q?.volume_change_24h) && q.volume_change_24h >= 10
          && Number.isFinite(q?.volume_24h) && q.volume_24h >= 5_000_000
          && Number.isFinite(updated) && now - updated >= 0 && now - updated <= 20 * 60_000;
      }).sort((a: any, b: any) => b.quote.USD.volume_change_24h - a.quote.USD.volume_change_24h).slice(0, 5);
      if (!candidates.length) {
        await record({ ok: true, outcome: "no_candidates", candidates: 0, attempts: 0, sent: 0 });
        return;
      }
      stage = "history";
      const history = await get(`/v3/cryptocurrency/quotes/historical?id=${candidates.map((a: any) => a.id).join(",")}&convert=USD&interval=15m&time_start=${Math.floor((now - 3 * 3600_000) / 1000)}&time_end=${Math.floor(now / 1000)}`);
      const assets: any[] = Array.isArray(history) ? history : history?.id ? [history] : Object.values(history ?? {});
      const day = new Date(now).toISOString().slice(0, 10);
      const count = await this.ctx.storage.get<{ day: string; count: number }>("daily");
      let sentToday = count?.day === day ? count.count : 0;
      let attempts = 0;
      let sent = 0;
      stage = "delivery";
      for (const a of candidates) {
        if (attempts >= 2 || sentToday >= 10) break;
        const asset = assets.find(x => Number(x.id) === a.id);
        const points = (Array.isArray(asset?.quotes) ? asset.quotes : []).map((x: any) => ({ timestamp: x.timestamp, price: usd(x.quote)?.price }));
        if (!confirms(points, now)) continue;
        const key = `last:${a.id}`;
        const last = await this.ctx.storage.get<number>(key);
        if (last !== undefined && now - last < 2 * 3600_000) continue;
        // Reserve cooldown and daily budget even on uncertain delivery.
        await this.ctx.storage.put({ [key]: now, daily: { day, count: ++sentToday } });
        attempts++;
        const delivered = await sendTelegram(this.env, `🚨 ALERTE CRYPTO\n\nCrypto : ${a.symbol}\nStatut : OBSERVATION\nPrix : ${points[points.length - 1].price} USD\nSignal : Deux hausses de 15 min, creux ascendant\nTP : Non défini\nSL : Non défini\nMotif : Hausse 1 h ≥ 1 %, volume 24 h ≥ 5 M USD et variation du volume ≥ 10 %. Signal technique à surveiller, sans garantie de gain.`);
        if (delivered) sent++;
      }
      await record({ candidates: candidates.length, attempts, sent, reserved_today: sentToday, ok: sent === attempts, outcome: attempts === 0 ? "no_alert" : sent === attempts ? "sent" : "delivery_unconfirmed" });
    } catch (error) {
      await record({ ok: false, outcome: "data_error", stage, kind: error instanceof ScanRequestError ? error.kind : "internal", ...(error instanceof ScanRequestError && error.code !== undefined ? { code: error.code } : {}) });
    }
  }
}
