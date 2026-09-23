import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

const CMC_URL =
  "https://pro-api.coinmarketcap.com/public-api/v3/cryptocurrency/listings/latest?start=1&limit=300&convert=USD";

function createServer() {
  const server = new McpServer({
    name: "CoinMarketCap Top 300",
    version: "1.0.0",
  });

  server.registerTool(
    "get_cmc_top_300",
    {
      description:
        "Retrieve the current CoinMarketCap Top 300 cryptocurrencies, ranked from 1 to 300, for market scanning and analysis.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const response = await fetch(CMC_URL, {
          headers: {
            Accept: "application/json",
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
        const coins = Array.isArray(result.data) ? result.data : [];

        const normalized = coins.map((coin: any) => ({
          rank: coin.cmc_rank,
          id: coin.id,
          name: coin.name,
          symbol: coin.symbol,
          slug: coin.slug,
          price_usd: coin.quote?.USD?.price ?? null,
          market_cap_usd: coin.quote?.USD?.market_cap ?? null,
          volume_24h_usd: coin.quote?.USD?.volume_24h ?? null,
          percent_change_1h:
            coin.quote?.USD?.percent_change_1h ?? null,
          percent_change_24h:
            coin.quote?.USD?.percent_change_24h ?? null,
          percent_change_7d:
            coin.quote?.USD?.percent_change_7d ?? null,
        }));

        const ranks = normalized
          .map((coin: any) => coin.rank)
          .filter((rank: any) => Number.isInteger(rank))
          .sort((a: number, b: number) => a - b);

        const complete =
          normalized.length === 300 &&
          ranks.length === 300 &&
          ranks.every((rank: number, index: number) => rank === index + 1);

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
                  last_rank: ranks[ranks.length - 1] ?? null,
                  ranks_1_to_300_complete: complete,
                  timestamp: result.status?.timestamp ?? null,
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
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return handler(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
