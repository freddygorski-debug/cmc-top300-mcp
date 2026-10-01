import { env } from "cloudflare:workers";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

const CMC_TOP300_URL =
  "https://pro-api.coinmarketcap.com/v3/cryptocurrency/listings/latest?start=1&limit=300&convert=USD";

const CMC_HISTORICAL_URL =
  "https://pro-api.coinmarketcap.com/v3/cryptocurrency/quotes/historical";

function getApiKey() {
  return (env as unknown as Record<string, string>).CMC_API_KEY;
}

function cmcHeaders(apiKey: string) {
  return {
    Accept: "application/json",
    "X-CMC_PRO_API_KEY": apiKey,
  };
}

function errorContent(data: any) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
    isError: true,
  };
}

// Telegram stays separate from the public, read-only CMC MCP tools.
type TelegramEnv = {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_TEST_SECRET?: string;
  TELEGRAM_TEST_ENABLED?: string;
};

async function sendTelegram(workerEnv: TelegramEnv, text: string): Promise<boolean> {
  const token = workerEnv.TELEGRAM_BOT_TOKEN;
  const chatId = workerEnv.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId || !/^-?\d+$/.test(chatId)) return false;
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) return false;
    const result = await response.json() as { ok?: boolean };
    return result.ok === true;
  } catch {
    // Never log the exception: its URL could contain the bot token.
    return false;
  }
}

async function telegramTest(request: Request, workerEnv: TelegramEnv): Promise<Response> {
  const reply = (status: number, data: Record<string, unknown>) =>
    Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
  if (workerEnv.TELEGRAM_TEST_ENABLED !== "true") return reply(404, { ok: false });
  if (request.method !== "POST") return reply(405, { ok: false });
  if (!workerEnv.TELEGRAM_TEST_SECRET || workerEnv.TELEGRAM_TEST_SECRET.length < 32) {
    return reply(503, { ok: false, error: "Test authentication not configured" });
  }
  if (!await telegramAuthorized(request, workerEnv)) {
    return reply(401, { ok: false });
  }
  const chatId = workerEnv.TELEGRAM_CHAT_ID?.trim();
  if (!workerEnv.TELEGRAM_BOT_TOKEN || !chatId || !/^-?\d+$/.test(chatId)) {
    return reply(503, { ok: false, error: "Telegram configuration incomplete" });
  }
  // Validation only by default. Sending requires the explicit send=1 flag.
  if (new URL(request.url).searchParams.get("send") !== "1") {
    return reply(200, { ok: true, dry_run: true, sent: false });
  }
  const sent = await sendTelegram(workerEnv, "Test cmc-top300-mcp : connexion Telegram opérationnelle.");
  return reply(sent ? 200 : 502, { ok: sent, sent });
}

async function telegramAuthorized(request: Request, workerEnv: TelegramEnv): Promise<boolean> {
  const secret = workerEnv.TELEGRAM_TEST_SECRET;
  if (!secret || secret.length < 32) return false;
  const authorization = request.headers.get("Authorization") ?? "";
  if (authorization.length > 1024) return false;
  const encoder = new TextEncoder();
  const [expected, supplied] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(`Bearer ${secret}`)),
    crypto.subtle.digest("SHA-256", encoder.encode(authorization)),
  ]);
  const a = new Uint8Array(expected);
  const b = new Uint8Array(supplied);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

const alertText = (max: number) => z.string().max(max).trim().min(1)
  .refine(value => !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value));
const alertValue = z.union([alertText(64), z.number().finite().nonnegative()]);
const telegramAlertSchema = z.object({
  symbol: alertText(32),
  status: alertText(80),
  price: alertValue,
  signal: alertText(160),
  take_profit: alertValue,
  stop_loss: alertValue,
  reason: alertText(1000),
}).strict();

async function telegramAlert(request: Request, workerEnv: TelegramEnv): Promise<Response> {
  const reply = (status: number, data: Record<string, unknown>) =>
    Response.json({ ok: false, sent: false, ...data }, {
      status, headers: { "Cache-Control": "no-store", ...(status === 405 ? { Allow: "POST" } : {}) },
    });
  if (request.method !== "POST") return reply(405, {});
  if (!workerEnv.TELEGRAM_TEST_SECRET || workerEnv.TELEGRAM_TEST_SECRET.length < 32) return reply(503, {});
  if (!await telegramAuthorized(request, workerEnv)) return reply(401, {});
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") return reply(415, {});
  // Bound actual streamed bytes, including requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return reply(400, {});
  const chunks: Uint8Array[] = [];
  let size = 0;
  let data: unknown;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        return reply(413, {});
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    return reply(400, {});
  } finally {
    reader.releaseLock();
  }
  const parsed = telegramAlertSchema.safeParse(data);
  if (!parsed.success) return reply(400, { error: "Invalid alert payload" });
  const chatId = workerEnv.TELEGRAM_CHAT_ID?.trim();
  if (!workerEnv.TELEGRAM_BOT_TOKEN || !chatId || !/^-?\d+$/.test(chatId)) return reply(503, {});
  const alert = parsed.data;
  const sent = await sendTelegram(workerEnv, [
    "🚨 ALERTE CRYPTO", "", `Crypto : ${alert.symbol}`, `Statut : ${alert.status}`,
    `Prix : ${alert.price}`, `Signal : ${alert.signal}`, `TP : ${alert.take_profit}`,
    `SL : ${alert.stop_loss}`, `Motif : ${alert.reason}`,
  ].join("\n"));
  return reply(sent ? 200 : 502, { ok: sent, sent });
}

function createServer() {
  const server = new McpServer({
    name: "CoinMarketCap Top 300 + Intraday",
    version: "1.1.0",
  });

  /*
   * ============================================================
   * TOOL 1 — TOP 300 COINMARKETCAP
   * ============================================================
   */

  server.registerTool(
    "get_cmc_top_300",
    {
      description:
        "Retrieve the current CoinMarketCap Top 300 cryptocurrencies with price, momentum, volume and market data for volatility scanning.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const apiKey = getApiKey();

        if (!apiKey) {
          return errorContent({
            ok: false,
            source: "CoinMarketCap",
            error: "CMC_API_KEY is not configured on the Worker",
          });
        }

        const response = await fetch(CMC_TOP300_URL, {
          headers: cmcHeaders(apiKey),
          cf: {
            cacheEverything: true,
            cacheTtl: 300,
          },
        });

        if (!response.ok) {
          return errorContent({
            ok: false,
            source: "CoinMarketCap",
            cmc_status: response.status,
          });
        }

        const result: any = await response.json();

        if (Number(result.status?.error_code ?? 0) !== 0) {
          return errorContent({
            ok: false,
            source: "CoinMarketCap",
            cmc_error_code: result.status?.error_code,
            cmc_error_message: result.status?.error_message,
          });
        }

        const coins = Array.isArray(result.data)
          ? result.data
          : [];

        const normalized = coins.map((coin: any) => {
          const usd = Array.isArray(coin.quote)
            ? coin.quote.find(
                (item: any) =>
                  item?.symbol === "USD" ||
                  item?.currency === "USD" ||
                  item?.name === "USD",
              ) ?? coin.quote[0]
            : coin.quote?.USD;

          return {
            rank: coin.cmc_rank,
            id: coin.id,
            name: coin.name,
            symbol: coin.symbol,
            slug: coin.slug,
            price_usd: usd?.price ?? null,
            market_cap_usd: usd?.market_cap ?? null,
            volume_24h_usd: usd?.volume_24h ?? null,
            volume_change_24h:
              usd?.volume_change_24h ?? null,
            percent_change_1h:
              usd?.percent_change_1h ?? null,
            percent_change_24h:
              usd?.percent_change_24h ?? null,
            percent_change_7d:
              usd?.percent_change_7d ?? null,
            last_updated:
              usd?.last_updated ??
              coin.last_updated ??
              null,
          };
        });

        const ranks = normalized
          .map((coin: any) => coin.rank)
          .filter((rank: any) => Number.isInteger(rank))
          .sort((a: number, b: number) => a - b);

        const complete =
          normalized.length === 300 &&
          ranks.length === 300 &&
          ranks.every(
            (rank: number, index: number) =>
              rank === index + 1,
          );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: true,
                  source: "CoinMarketCap",
                  retrieved: normalized.length,
                  first_rank: ranks[0] ?? null,
                  last_rank:
                    ranks[ranks.length - 1] ?? null,
                  ranks_1_to_300_complete: complete,
                  timestamp:
                    result.status?.timestamp ?? null,
                  coins: normalized,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return errorContent({
          ok: false,
          source: "CoinMarketCap",
          error: String(error),
        });
      }
    },
  );

  /*
   * ============================================================
   * TOOL 2 — DONNEES INTRADAY 15 MINUTES
   * ============================================================
   */

  server.registerTool(
    "get_cmc_intraday_15m",
    {
      description:
        "Retrieve recent 15-minute CoinMarketCap historical quote points for selected cryptocurrencies. Designed to detect acceleration, stabilization, higher lows and early bullish momentum after a Top 300 volatility scan.",

      inputSchema: z.object({
        ids: z
          .string()
          .describe(
            "Comma-separated CoinMarketCap IDs, for example 8916 or 8916,1,1027",
          ),

        hours: z
          .number()
          .int()
          .min(1)
          .max(24)
          .default(6)
          .describe(
            "Number of recent hours to retrieve. Default 6, maximum 24.",
          ),
      }),
    },

    async ({ ids, hours }) => {
      try {
        const apiKey = getApiKey();

        if (!apiKey) {
          return errorContent({
            ok: false,
            source: "CoinMarketCap",
            error: "CMC_API_KEY is not configured on the Worker",
          });
        }

        const cleanIds = ids
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);

        if (cleanIds.length === 0) {
          return errorContent({
            ok: false,
            error: "No CoinMarketCap ID supplied",
          });
        }

        /*
         * We deliberately limit one request to 30 candidates.
         * The Top 300 tool performs the broad scan first.
         */
        if (cleanIds.length > 30) {
          return errorContent({
            ok: false,
            error:
              "Maximum 30 cryptocurrencies per intraday request. Run the Top 300 volatility filter first.",
          });
        }

        const now = new Date();

        const start = new Date(
          now.getTime() - hours * 60 * 60 * 1000,
        );

        const params = new URLSearchParams({
          id: cleanIds.join(","),
          convert: "USD",
          interval: "15m",
          time_start: start.toISOString(),
          time_end: now.toISOString(),
        });

        const url =
          `${CMC_HISTORICAL_URL}?${params.toString()}`;

        const response = await fetch(url, {
          headers: cmcHeaders(apiKey),
          cf: {
            cacheEverything: true,
            /*
             * Short cache because this tool is intended
             * to detect recent momentum.
             */
            cacheTtl: 60,
          },
        });

        if (!response.ok) {
          const body = await response.text();

          return errorContent({
            ok: false,
            source: "CoinMarketCap",
            cmc_status: response.status,
            response: body,
          });
        }

        const result: any = await response.json();

        if (Number(result.status?.error_code ?? 0) !== 0) {
          return errorContent({
            ok: false,
            source: "CoinMarketCap",
            cmc_error_code:
              result.status?.error_code,
            cmc_error_message:
              result.status?.error_message,
          });
        }

        /*
         * CoinMarketCap can return a single object
         * or an object keyed by cryptocurrency ID.
         */
        const rawData = result.data ?? {};

        const assets = Array.isArray(rawData)
          ? rawData
          : rawData.id
            ? [rawData]
            : Object.values(rawData);

        const normalized = assets.map((asset: any) => {
          const quotes = Array.isArray(asset?.quotes)
            ? asset.quotes
            : [];

          const points = quotes.map((item: any) => {
            const usd = Array.isArray(item.quote)
              ? item.quote.find(
                  (q: any) =>
                    q?.symbol === "USD" ||
                    q?.currency === "USD" ||
                    q?.name === "USD",
                ) ?? item.quote[0]
              : item.quote?.USD;

            return {
              timestamp:
                item.timestamp ??
                usd?.timestamp ??
                null,

              price_usd:
                usd?.price ?? null,

              volume_24h_usd:
                usd?.volume_24h ?? null,

              market_cap_usd:
                usd?.market_cap ?? null,
            };
          });

          /*
           * Calculate simple price changes between
           * consecutive 15-minute observations.
           */
          const enrichedPoints = points.map(
            (point: any, index: number) => {
              const previous =
                index > 0
                  ? points[index - 1]
                  : null;

              let change15m = null;

              if (
                previous?.price_usd &&
                point?.price_usd
              ) {
                change15m =
                  ((point.price_usd -
                    previous.price_usd) /
                    previous.price_usd) *
                  100;
              }

              return {
                ...point,
                change_15m_pct: change15m,
              };
            },
          );

          return {
            id: asset?.id ?? null,
            name: asset?.name ?? null,
            symbol: asset?.symbol ?? null,
            points: enrichedPoints,
          };
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: true,
                  source: "CoinMarketCap",
                  interval: "15m",
                  requested_hours: hours,
                  requested_assets:
                    cleanIds.length,
                  returned_assets:
                    normalized.length,
                  timestamp:
                    result.status?.timestamp ?? null,
                  assets: normalized,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return errorContent({
          ok: false,
          source: "CoinMarketCap",
          error: String(error),
        });
      }
    },
  );

  return server;
}

const handler = createMcpHandler(createServer);

export default {
  fetch(
    request: Request,
    workerEnv: Env,
    ctx: ExecutionContext,
  ) {
    if (new URL(request.url).pathname === "/telegram/alert") {
      return telegramAlert(request, workerEnv as unknown as TelegramEnv);
    }
    if (new URL(request.url).pathname === "/telegram/test") {
      return telegramTest(request, workerEnv as unknown as TelegramEnv);
    }
    return handler(request, workerEnv, ctx);
  },
} satisfies ExportedHandler<Env>;
