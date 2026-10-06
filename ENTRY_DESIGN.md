# Entry alerts v3 — draft, no production change

A single entry notification per tracked occasion replaces entry plus closure. Outcomes remain in the audit. Existing v1/v2 plans retain their thresholds and legacy expiry, but receive no automatic closure message. New v3 plans use a persistent quote checkpoint and continue beyond four hours while support/target remain untouched and data continuity is valid. Four hours triggers a silent review record; it is not a holding limit or order. Two open scenarios can therefore occupy follow-up capacity for longer. No maximum holding period was authorized.

## Available evidence

300 listing quotes give 1h/24h/7d and rolling 24h volume context. Up to five six-hour sampled histories per scan establish a four-hour trend, sampled supports and peaks. They are not candles or interval volume. One silent radar slot, two strongest-hour slots and rotation share remaining capacity after open scenarios. Candidates need not have 1h return below 4%; positive 24h assets with a mild negative hour remain eligible. Coverage remains partial. This is not the entire qualitative Scan 5% method.

Patterns: early local breakout, continuation in a rising four-hour context, and early recovery after pullback. Two pre-existing rising troughs are no longer required. Typical sampled volatility limits chase extension. A recent quote below the last sample rejects; a second quote immediately before dispatch must not fall below the signal price or exceed its maximum. This cannot determine the slope between two equal/up quotes and cannot prevent subsequent reversal.

Provisional thresholds: four-hour decline below -0.5% rejects; 24h below -3% needs four-hour recovery of at least 1%; rolling volume decline below -20% rejects. A positive sampled hour is required. These rules are documented starting choices, not calibrated or validated trading results. Very early recoveries may remain excluded. BTC/ETH hourly context is available only when both quotes exist; it is not a mandatory bullish veto.

Zone is live +/-0.15%. Target is upper zone *1.0255. Technical stop lies below sampled support with 0.2–0.4% buffer, capped at 2% risk from upper zone. An overhead sampled peak must leave room for target. With no sampled peak, the previous four-hour advance must cover the target distance: provisional momentum projection, not evidence of a guaranteed price. Price discovery is therefore treated with explicit uncertainty.

Objective aims at about 2% net under the user's assumed total spread <=0.5%; Neverless availability, execution quotes and actual round-trip costs remain unchecked. Five-minute OHLC, candle volume, macro and actual portfolio holdings are also unavailable. The manual prompt can research these; this automated revision cannot claim full prompt fidelity.

## Optional publication evidence

`src/news.ts` adds a bounded publication lookup for ETH, FIL, SUI and STX. These are the only supported IDs/symbols; other assets explicitly remain unverified. Ethereum Foundation and Sui expose RSS feeds. Filecoin publishes JSON-LD: examine only the first two allowlisted articles in its index. The Stacks site is an ecosystem aggregator, not necessarily the original announcement author, and the alert labels it as such. This is publication evidence, not semantic verification of a market catalyst or an assertion of price causation. Even a recent official article may be irrelevant to the trade.

Check publication time (not modification time), reject future/undated records, and search a provisional 72-hour window. At most 30 RSS items or two Filecoin detail pages are examined. “None verified in consulted publications”, “source unavailable” and “no source configured” remain different states. An old post modified today cannot be presented as a new announcement. The lookup does not parse or validate future event dates within article text.

Cache both success and failure for one hour, recheck recency when reading cache, cap documents at 1 MB and share a three-second timeout across each source's requests. Use fixed HTTPS sources and exact host/path allowlists, reject credentials/query strings and never follow redirects. Requests contain no CMC or Telegram credentials. Requests run alongside history; optional news can add at most three seconds when history is faster. The dispatch quote is read after news has settled and is still checked with a five-minute age limit. News success is never an additional entry confirmation or a veto. The new sources require no subscription or secret, and do not consume CMC credits.

Manual source-adapter validation on 2026-10-06 at 12:24 Paris succeeded for all four configured sources (six HTTP requests, no Telegram send). ETH/STX had recent publications; the consulted FIL/SUI articles did not. This checks parsing/access from the local runtime, not permanent availability or production network access. Failures from production remain explicitly unavailable.

## Context and replay

Before dispatch, refresh available 24h/7d/rolling-volume context as well as price; deteriorated volume can reject even an unchanged price. The alert shows the current quote time and the asset's reported one-hour change relative to BTC in percentage points, when available. These are CMC rolling changes, not synchronized candle comparisons or a new market veto. BTC/ETH context requires fresh listing quotes; the audit includes positive/negative breadth, median hour and actual non-stablecoin coverage.

Persist the last 24 scans' bounded source snapshots: selected listing quotes, sampled history, publication status/evidence, actual dispatch quote, coverage and decisions. This allows inspection of observed cases without fabricating inputs from later charts. The universe remains 300 listing quotes and at most five detailed histories; recording missing coverage is not full coverage. Public publication links are retained in storage; no source response body or credential is logged.

## Quota and protections

Six hours gives at most approximately 25 samples per asset, 125 across five assets. According to CMC's current credit guide: listings/quotes latest use one credit per 250 assets, historical quotes one per 100 points. 300 listings (2) + history (2) = about 4 credits/run, or 11,904 over 31 days. Fresh quotes are capped globally at ten attempts/day, including rejected/failed checks: at most 310 more. Estimated total <=12,214, leaving margin below 15,000 for manual scans. Actual credit_count/dashboard must confirm this estimate. Source: https://coinmarketcap.com/api/resources/what-one-credit-buys-endpoint-by-endpoint/

Keep five-history ceiling, two open scenarios, two new send attempts/run, ten entry attempts/day and persistent per-asset two-hour cooldown. Reservations precede delivery; uncertain sends are not retried. A persistent setup identifier uses the timestamp of the sampled support; the same support cannot generate a repeated entry in the same mode after closure or restart. A newly sampled support may qualify as a new occasion after cooldown. This is sample-based identity, not a proof of distinct market structure.

Audit includes actual coverage, rejection reason, calculated metrics, context, pre-send rejection and plan/outcome. No credentials, upstream error text or message bodies. Existing tools, private routes, sendTelegram, secret names and dashboard variables are untouched. keep_vars preserves activation settings. Merge/deployment requires Freddy's explicit validation.

## Validation

35 behavior tests cover stale/falling quotes, risk/target constraints, stronger hourly movers, fresh price/context rejection, persisted budgets/cooldown, rolling follow-up checkpoints, silent outcomes, publication age/cache/failures/allowlists/bounds, snapshot retention including dispatch failures and legacy Telegram routes. TypeScript also checked. These establish behavior, not profitability; this is a draft revision needing prospective evaluation and missing-data integration, not a completed investment strategy.
