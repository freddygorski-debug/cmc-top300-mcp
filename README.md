# Building a Remote MCP Server on Cloudflare (Without Auth)

## Private Telegram alerts

`POST /telegram/alert` requires `Authorization: Bearer <TELEGRAM_TEST_SECRET>`
(existing secret, at least 32 characters) and `Content-Type: application/json`.
It uses the existing Telegram token and chat ID; no new secrets are required.
Unlike `/telegram/test`, alerts do not depend on `TELEGRAM_TEST_ENABLED` and
send immediately after authentication and validation.

All seven fields are required. Text fields must be nonempty single-line strings:
`symbol` (32 characters), `status` (80), `signal` (160), `reason` (1000).
`price`, `take_profit`, and `stop_loss` accept a finite nonnegative number or
a nonempty single-line string (64 characters, e.g. `102 USD`). Unknown fields
are rejected. The body is limited to 8192 bytes, even without Content-Length.

Success returns HTTP 200 with `{ "ok": true, "sent": true }`. Failures return
`ok: false, sent: false`: 400 invalid payload, 401 unauthorized, 405 wrong method,
413 body too large, 415 wrong content type, 503 missing configuration, or
502 Telegram failure. Responses are not cached and do not include upstream errors.
The public CMC tools and `/telegram/test` disabled/dry-run/send behavior are retained.

Run `npm test`, `npm run type-check`, and `npx wrangler deploy --dry-run`
to validate locally without sending Telegram messages or deploying.

This example allows you to deploy a stateless remote MCP server that doesn't require authentication on Cloudflare Workers. It implements the MCP 2026-07-28 specification while remaining compatible with legacy clients for ordinary tool calls.

## Get started:

[![Deploy to Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-authless)

This will deploy your MCP server to a URL like: `remote-mcp-server-authless.<your-account>.workers.dev/mcp`

Alternatively, you can use the command line below to get the remote MCP Server created on your local machine:

```bash
npm create cloudflare@latest -- my-mcp-server --template=cloudflare/ai/demos/remote-mcp-authless
```

## Customizing your MCP Server

To add your own [tools](https://developers.cloudflare.com/agents/model-context-protocol/protocol/tools/) to the MCP server, register each tool on the `McpServer` created in the `createServer()` function in `src/index.ts` using `server.registerTool(...)`.

## Connect to Cloudflare AI Playground

You can connect to your MCP server from the Cloudflare AI Playground, which is a remote MCP client:

1. Go to https://playground.ai.cloudflare.com/
2. Enter your deployed MCP server URL (`remote-mcp-server-authless.<your-account>.workers.dev/mcp`)
3. You can now use your MCP tools directly from the playground!

## Connect Claude Desktop to your MCP server

You can also connect to your remote MCP server from local MCP clients, by using the [mcp-remote proxy](https://www.npmjs.com/package/mcp-remote).

To connect to your MCP server from Claude Desktop, follow [Anthropic's Quickstart](https://modelcontextprotocol.io/quickstart/user) and within Claude Desktop go to Settings > Developer > Edit Config.

Update with this configuration:

```json
{
	"mcpServers": {
		"calculator": {
			"command": "npx",
			"args": [
				"mcp-remote",
				"http://localhost:8787/mcp" // or remote-mcp-server-authless.your-account.workers.dev/mcp
			]
		}
	}
}
```

Restart Claude and you should see the tools become available.

## Automatic observation alerts (disabled by default)

The `*/15 * * * *` cron invokes a single SQLite Durable Object only when
`AUTO_SCAN_ENABLED` is exactly `true`. This variable is intentionally absent from
Wrangler configuration. No scans or automatic sends occur before activation.
Do not enable until the PR, deployment and CoinMarketCap plan/quota are checked.

Each run reads the Top 300, excludes assets tagged `stablecoin`, and considers
at most five assets with price change over 1 hour >= 1%, 24-hour volume >=
5 million USD, and volume change over 24 hours >= 10%. These are explicit
screening heuristics, not a prediction or a guarantee of a 2% gain.

Confirmation uses the last nine consecutive 15-minute price samples: the last
two intervals must rise, and the two most recent strict local troughs must
rise. Samples must be positive, finite, uninterrupted (one-minute timestamp
tolerance), and no older than 20 minutes. These are sampled prices, not candle
lows. Listings must also be fresh. Unsupported/missing USD data is ignored.

Alerts say OBSERVATION with TP and SL non-defined, and reuse `sendTelegram`.
A persistent per-CMC-ID cooldown reserves two hours before sending, even if
Telegram delivery fails or is uncertain. A global serialized queue and saved
cron slot prevent overlapping or replayed events. Maximum two attempts per
run and ten per UTC day; failed deliveries count toward these limits and are
not retried. Stored state contains only IDs, times, counters and safe status.
No upstream errors or secrets are logged by the scanner.

Budget: 96 runs/day. The Top 300 alone costs 192 CMC credits/day or 5,760 per
30 days under the documented 1 credit per 250 results rule. Historical calls
add credits when shortlisted assets exist (up to five assets over three hours
per run); confirm historical endpoint access and actual credit accounting in
your CMC account before enabling. Existing MCP use consumes additional credits.
Reference: https://coinmarketcap.com/api/documentation/pro-api-reference/cryptocurrency

Deployment creates the ObservationScanner binding and its initial SQLite
migration. `keep_vars: true` preserves dashboard variables such as
TELEGRAM_TEST_ENABLED on subsequent deployments. No Cloudflare secrets are
changed. To stop scans, set AUTO_SCAN_ENABLED to false or remove that dashboard
variable. The private alert/test routes and the two public CMC tools remain.
