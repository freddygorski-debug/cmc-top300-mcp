import { env } from "cloudflare:workers";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

const CMC_URL =
  "https://pro-api.coinmarketcap.com/v3/cryptocurrency/listings/latest?start=1&limit=300&convert=USD";

function createServer() {
  const server = new McpServer({
    name: "CoinMarketCap Top 300",
    version: "1.0.0",
  });

  server.registerTool(
    "get_cmc_top_300",
    {
      description:
        "Retrieve the current CoinMarketCap Top 300 cryptocurrencies with price, momentum, volume and market data for Neverless 2% scanning.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const apiKey = (
          env as unknown as Record<string, string>
        ).CMC_API_KEY;

        if (!apiKey) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  source: "CoinMarketCap",
                  error: "CMC_API_KEY is not configured on the Worker",
                }),
              },
            ],
            isError: true,
          };
        }

        const response = await fetch(CMC_URL, {
          headers: {
            Accept: "application/json",
            "X-CMC_PRO_API_KEY": apiKey,
          },
          cf: {
            cacheEverything: true,
            cacheTtl: 300,
          },
        });

        if (!response.ok) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ok: false,
                    source: "CoinMarketCap",
                    cmc_status: response.status,
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        const result: any = await response.json();

    if (Number(result.status?.error_code ?? 0) !== 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ok: false,
                    source: "CoinMarketCap",
                    cmc_error_code: result.status.error_code,
                    cmc_error_message: result.status.error_message,
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
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
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: false,
                  source: "CoinMarketCap",
                  error: String(error),
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
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
    return handler(request, workerEnv, ctx);
  },
} satisfies ExportedHandler<Env>;
