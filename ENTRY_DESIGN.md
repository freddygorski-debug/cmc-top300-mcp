# Entry alerts v1 — provisional, silent simulation by default

The existing 15-minute cron, Durable Object binding/migration and Telegram secrets
are retained. AUTO_SCAN_ENABLED=true permits scans. OBSERVATION notifications are
replaced by silent simulation unless ENTRY_ALERTS_ENABLED is exactly true. Deploy
after approval, collect prospective results, then separately approve activation.
keep_vars preserves dashboard variables. No new secret or PowerShell command is
needed. Neither mode places orders; private routes and public CMC tools remain.

Agreed policy: aim for 2% net assuming total Neverless spread 0.3–0.5%, follow
for <=4 hours, invalidate around 2% below entry, avoid repeated watch messages.
CMC cannot verify Neverless availability, execution prices or spread. Target is
2.55% above the upper entry boundary: 1.0255 * 0.995 - 1 = 2.03725%. This is a
conditional estimate, not a realized/guaranteed return. Stop is 2% below that upper
boundary; loss from a different fill and slippage differ. Owner checks live prices.

Proposed, unvalidated rule (src/entry.ts), evaluated only at the latest sample:
- Twelve consecutive 15-minute prices, latest <=20 minutes old; listing <=5
  minutes old and no older than history. Missing/gapped data reject the entry.
- Penultimate sample is a local low higher than the previous strict local low.
  Last sample recovers 0.2–0.8%; previous sampled high is 3–8% above that low.
- Current price is <=0.3% above the last sample and <=0.1% below it. Entry zone is
  current price ±0.15%, valid 15 minutes. Dates in entry messages use Paris time.
- Target from the top of the zone must fit below the previous sampled high;
  stop must be below the pullback low with a 0.2% buffer. Otherwise stay silent.

Screen Top 300 non-stablecoins with volume >=5M USD and positive 1h return <=4%.
Rotate by CMC ID, verify <=5 histories per run including <=2 open entries, even
when they leave screening. This is limited coverage, not continuous analysis of
all 300 histories. The old +1%/1h and +10% volume trigger is removed. Rolling 24h
volume is not interval volume; samples are not candle highs/lows.

One notification per occasion, <=2 open, <=2 new-entry attempts per run, <=10 per
UTC day; persistent 2h per-ID cooldown and saved slot prevent duplicates. Failed
or uncertain sends count and are not retried. A notified entry receives <=1 closure:
sampled target, invalidation, 4h expiration, or unavailable data. Follow-up checks
subsequent samples chronologically and rejects gaps. Intrainterval touches and
actual fills are unknown. It cannot know whether the owner bought.

Paper/live budgets are separate. Mode changes close previous-mode simulations
with an audit event rather than promoting old plans. Paper sends no messages.
Last 100 events persist in entry_audit, including failures and expirations;
controlled public plan/outcome fields appear in Cloudflare logs. Credentials,
request URLs, message bodies and upstream error text are never logged.

History is four hours for <=5 assets (normally <=85 sampled quotes). Estimated
usage remains ~8,640 CMC credits/30 days at 96 scans/day under earlier accounting
assumptions; verify actual quota and allow for manual calls. Tests establish
behavior, not profitability. An empty shortlist or missed opportunity is possible.

Pattern-only development replay: 96 samples each for MINA/ZRO/ATH, retrieved
3 October 2026 at 09:11 UTC. Zero MINA/ZRO plans; one ATH plan followed by a sampled
target observation. Immediate data was assumed; live shortlist, latency, spread,
execution and OHLC were excluded. This tiny selected sample does not validate
reliability or net returns. Thresholds must not be tuned to this result.
