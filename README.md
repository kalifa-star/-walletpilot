# WalletPilot

A forex strategy and paper-execution backend for the banking/fintech integration concept in [IDEA.md](IDEA.md). The main dashboard reads server-side market observations, decisions, positions, accounting, and backtest results. It does not use the original six scripted prices.

Independent concept; no bank, broker, real wallet, or OPay account is connected. This implementation seeks to make the strategy measurable. It has not established profitable performance or an ability to multiply a small deposit reliably.

## Run

Requires **Node.js 22+**. No packages to install.

```sh
npm run dev
```

Open **http://localhost:3000**. Restart a previously running version of the server to load the new API routes. The server listens on loopback only; use the local URL. It is a single local paper account shared across browser tabs, not a hosted multi-user banking service.

## Render deployment (free demo)

The included `render.yaml` selects only a Free Docker web service, with mock
payments and paid AI review disabled. No paid disk or database is configured.
The server automatically accepts the HTTPS URL in `RENDER_EXTERNAL_URL`.
Connect this repository on Render and deploy using its Blueprint, or create a
Free Docker web service with healthcheck path `/health`.

Render Free sleeps after 15 minutes without traffic. Local account state,
archives, models, and payment-test records are lost on sleep, restart, or
redeploy. The bot and observer stop while asleep. This deployment is a shared
public demo without authentication; do not configure merchant credentials or
store private data in it. Keep the service on Free and do not add paid resources.

## Railway deployment

The included Dockerfile runs Node.js 22 and binds to `0.0.0.0` using Railway's `PORT`.
Create a Railway service from this repository, generate a public domain, and
attach a persistent volume mounted at `/app/.runtime`. Keep one replica because
state is stored in local JSON files. Set the healthcheck path to `/health`.
The app accepts the HTTPS origin from `RAILWAY_PUBLIC_DOMAIN`; for a custom
domain, set `PUBLIC_ORIGIN=https://your-domain.example`.

Leave `OPAY_MODE=mock` and `AI_REVIEW_ENABLED=false` for the default demo.
No credentials are required for those modes. Runtime files and `.env` files
are excluded from the image, so deployment starts with a fresh paper account.
The hosted app shares one paper account across visitors and has no login;
anyone with its URL can change that demo account. Do not add payment credentials
or private account data to a public demo.

Railway's Free plan is usage-limited rather than unlimited always-on hosting.
Use the Free plan without upgrading; monitor available credits. Sleeping or
stopped services cannot continuously collect market data or run the bot.

## OPay-targeted integration

Open **http://localhost:3000/opay** for the new wallet host concept, embedded trading experience, and payment-integration lab. OPay is now the selected target; this remains an independent concept outside the real OPay app.

The local mock works without credentials. The connector also implements OPay Nigeria staging wallet-QR creation, status queries, and verified callbacks using server-side merchant credentials. Payment tests stay separate from virtual trading balances. Native app embedding, customer-wallet access, real funding, and trading payouts are not established by a merchant-payment integration.

See [OPAY_INTEGRATION.md](OPAY_INTEGRATION.md) for setup, documented API scope, mock/staging flows, and remaining partnership requirements. The current strategy's failed screening result is unchanged.

## Market memory and model training

The **Market memory & model lab** panel adds an actual locally trained numerical model. It does not need an OpenAI key. The optional language-model entry reviewer remains a separate component.

1. Restart the server and reload the page. Existing account balances/positions are preserved; trading automation pauses on restart. Existing market observations are migrated into the archive.
2. Use **Start observing** to collect independently of any allocation. ECB reference data is polled hourly; the optional intraday feed is polled once per minute. **Collect now** makes a single collection. A connected/imported trading dataset is also archived.
3. Select an archived dataset and virtual NGN budget, then **Train & evaluate**. At least 300 observations are required. Training uses the current account's risk/cost settings, or defaults when no account exists.
4. Inspect train/validation/test sample counts, held-out return, the fixed-rule and cash baselines, prediction error, drawdown, fees, and every screening check. A failed candidate is retained honestly as research.
5. To inspect a trained candidate's historical decisions, reset the paper account (archive/models survive), select the candidate, then **Replay candidate test period**. The budget and risk policy are pinned to that experiment, and replay starts after validation. Replaying the test period is research, not new forward evidence.
6. **Promote for forward paper** is available only for an intraday-provider candidate that passes screening. Promotion is explicit and cannot change a funded account. Allocation requires the same feed, budget, policy, and newly collected observations after the entire experiment. Daily/CSV models remain historical research. Banking and real-money execution remain unavailable.

The observer persists its enabled setting across server restarts and resumes collection while the server runs. It does not run when the server/machine is off. Stopping/resetting paper trading does not stop the observer. **Stop observing** stops independent collection; an open forward paper position can still require its own price/risk polling.

### What the model learns

The first model is deterministic, L2-regularized logistic regression implemented locally in JavaScript. Seven features describe one-, five-, and twenty-observation returns, moving-average trend, RSI, ATR relative to price, and recent return volatility. It learns coefficients from historical examples instead of following only fixed entry rules. Features use only the prefix available at that observation.

The target is whether a hypothetical long position entered at the next observation's open and exited at the fifth observation's close makes money after assumed spread, slippage, and two order fees. Label notional uses the selected capital and maximum-position fraction. Actual executed position sizing, stops, targets, cash, changing equity, and exits can differ, so the predicted probability is not the win probability of the actual order. Capital is part of the experiment because fixed fees affect small accounts differently.

Data is split chronologically **60% training / 20% validation / 20% test**. Five signal rows near each boundary are excluded so their target labels cannot reach the next partition. Feature scaling is learned from training only. The classifier uses 400 fixed optimization iterations with fixed regularization; a small entry-threshold search uses validation returns only. The last test segment never selects parameters. There is no shuffled split or test-based parameter tuning. These leakage controls follow the principles in [scikit-learn's preprocessing guidance](https://scikit-learn.org/stable/common_pitfalls.html) and [time-series splitting documentation](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html); the app does not depend on scikit-learn.

An entry needs the learned probability to exceed the selected threshold. Exits can be requested after the holding horizon, a low probability, or the baseline trend-exit condition; requests fill at a later observation. Features more than six training standard deviations outside the training distribution cause abstention. The separate paper risk engine remains authoritative for sizing, cash limits, daily losses, account drawdown, and stops. The optional language-model reviewer can veto a model entry but cannot bypass these controls.

### Evaluation, memory, and retraining

The model and fixed-rule baseline use the **same test dates, starting capital, and cost policy**. Screening requires positive test return above zero-interest cash, return above the fixed-rule baseline, at least five closed trades, drawdown below the account limit, and a test Brier score better than a constant predictor based on the training-set positive rate. Brier measures probability error (lower is better); accuracy alone can be misleading when most examples are unprofitable. Passing this small-sample screen only makes an intraday candidate eligible for experimental paper deployment. It is not proof of profitability or a real-money approval.

After training, the observer records predictions for the newest observation beyond the full experiment's cutoff without funding trades. It never backfills predictions for earlier bars in a newly received batch. Five later observations are needed before the target outcome can be scored. The dashboard shows these archive-based prediction counts and Brier scores. Historical extensions/imports are not live forward evidence, and prediction error is not trading P/L.

Check **Create a research candidate after 50 new observations** before starting the observer to enable scheduled retraining. The first candidate needs 300 observations; subsequent candidates require 50 genuinely later rows for that series. A schedule failure is displayed separately from the feed and existing trading account. Candidates are never automatically promoted and models already pinned to an account do not change.

Archive data is deduplicated by timestamp, separated by source and interval, and keeps correction counts. A candidate saves its exact data snapshot, fingerprint, feature normalization, weights, costs, threshold, split boundaries, label audit dates, and evaluation results. Identical experiments are deduplicated. Paper reset preserves all research. The current local bounds are 20 series, 100,000 observations per series (oldest pruned), 20 saved models, and the most recent 5,000 observations per training run. Only the latest candidate and explicitly active model generate new shadow predictions; each model retains up to 2,000 prediction records. None of this substitutes for an institutional market-data store.

Repeatedly inspecting or retraining against a test period can overfit it. Labels overlap within each partition, so metrics are not statistically independent observations. Fresh forward paper evidence over different market conditions is still required.

### Saved real-data experiment

The first training run used the **384 real ECB observations already collected in your paper session**, with the original ₦20,000 allocation / $12.4375 after conversion. It generated **0 trades and 0% test return**, and its test prediction error was worse than the constant-probability baseline. It **failed screening**; inactivity is not evidence of a profitable strategy.

See [the experiment report](reports/training-latest.md) and [machine-readable results](reports/training-latest.json). You can regenerate this offline report without modifying the running account:

```sh
npm run train
```

This command reads the saved dataset, writes a full candidate under ignored `.runtime/candidates/`, and writes the reviewable report under `reports/`. It neither registers nor promotes that candidate in the running server. **Train & evaluate** in the restarted dashboard creates the corresponding registry entry.

## Connect market data

**Historical research, no API key:** choose **ECB daily** and click **Connect market**. The server requests about 18 months of EUR/USD reference rates from [Frankfurter](https://frankfurter.dev/), scoped to the ECB provider. These are daily reference fixings, not executable forex quotes. They support historical research/replay only. No live-trading claim is made from daily data.

**Forward paper trading:** copy `.env.example` to `.env`, set `TWELVE_DATA_API_KEY`, and restart the server. Choose **Twelve Data**, connect the feed, and select forward mode when allocating. The adapter requests EUR/USD one-minute candles using the [time-series API](https://twelvedata.com/docs). Your provider account must grant the relevant data access; delays and quotas depend on the plan. The adapter discards incomplete candles. Forward orders require a completed candle no more than three minutes old. A delayed feed or closed market can block execution.

**Historical CSV:** use **Import CSV** with a dataset you obtained. The application labels this as user-supplied, unverified provenance. Rows must be chronological, unique, positive finite OHLC prices; timezone is required. The maximum is 5,000 rows / 800 KB.

```csv
time,open,high,low,close
2025-01-02T00:00:00Z,1.035,1.04,1.03,1.038
```

The row above illustrates the format, not an authentic market observation. At least 30 observations are needed for a paper account, or 100 for the backtest. Network/provider errors remain visible; the application never silently falls back to synthetic prices.

## Run the bot

1. Connect data, then **Set allocation & controls**. The default moves virtual ₦20,000 from a ₦100,000 wallet into $12.4375 after an illustrative conversion charge.
2. Choose historical replay or forward paper mode. Set position, per-entry risk, daily-loss, and account-drawdown limits.
3. **Start bot** advances historical observations once per second, or polls for new intraday candles once per minute. **Single step** advances the historical strategy manually. In forward mode, **Poll new candle** monitors the next available candle; starting the bot enables strategy entries.
4. Inspect computed indicators, proposed actions, queued orders, paper fills, stops, targets, fees, equity, and the audit trail. A buy signal is queued for a later observation, not filled using its own closing price.
5. **Pause bot** clears queued proposals and stops strategy orders. It does not close positions. Forward paper mode continues monitoring an open position once per minute and can close it through the independent risk engine. Paused historical replay advances only when manually stepped; a manual step authorizes strategy evaluation.
6. **Close position & return virtual funds** liquidates at the available paper price and converts back to NGN. Forward withdrawal requires fresh market data; an unavailable feed cannot produce an invented fill. The USD account then displays a settled snapshot, not spendable funds.

The server must remain running for automation. Restart pauses automation and discards pending orders while preserving the account and position. Reconnect/resume checks current data. Market gaps discard old entry proposals.

## Strategy and independent controls

The baseline strategy is **rules-based**, not a trained predictive model:

- SMA 5 > SMA 20 by more than 0.02%, and simple-window RSI 14 between 45 and 70: propose entering EUR.
- SMA 5 < SMA 20 or RSI 14 ≥ 75: propose closing EUR.
- Otherwise hold. Minimum indicator warmup: 21 observations.
- ATR 14 sets stop distance at 2× ATR, with a minimum distance of 0.2% of price. Target: twice the entry-to-stop distance.

The paper execution module separately limits position notional to 40% of equity and planned stop risk to 1%, including estimated round-trip costs. It also checks available cash and blocks new entries once the day's order count reaches 10; closing positions remains allowed. Default daily-loss threshold is 2%; account drawdown threshold is 5% from the observed equity peak. Daily loss resets on a UTC-date change at the first observed price; the account drawdown stop stays latched. Stops/targets and account-loss checks operate while strategy orders are paused. No leverage, borrowing, short positions, or pyramiding are implemented.

Thresholds are instructions rather than guaranteed caps. The bar-based simulator assumes stop-first execution when both stop and target occur in a historical candle. Daily reference data has no intraday range, so that mode cannot realistically evaluate intraday stops. Forward fills use the next observed completed close, with assumed spread/slippage, rather than broker bid/ask quotes. These approximations must be replaced/calibrated before execution-quality claims.

## Optional AI entry review

The baseline works without an AI key and clearly says **rules-only**. To enable actual model calls, set these **on the server** in `.env` and restart:

```dotenv
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=your_available_structured_output_model
AI_REVIEW_ENABLED=true
```

The reviewer uses the [OpenAI Responses API with Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs). It sees the recent observed bars and calculated indicators for a proposed entry, then returns a validated `allow`/`veto` and explanation. It cannot increase an order, change risk limits, access wallet credentials, or execute trades. Timeouts, refusal, incomplete or malformed output block the entry. Risk exits do not wait for AI approval. Requests are capped at 20 per paper account; enabling review incurs API charges. Keys are neither sent to the frontend nor written into account state.

AI review is experimental. It does not establish better returns than the rules baseline. The backtest evaluates the deterministic baseline only; it does not replay model reviews or include their cost. Market-data credentials and actual live API access must be configured and tested separately.

## Evaluation and accounting

**Run backtest** uses a fixed strategy with an earlier 70% research segment and later 30% evaluation segment. Earlier prices provide indicator warmup; no later prices are exposed to earlier decisions. Historical signals fill on the next observation's open; positions are liquidated at the segment end. Results show net USD returns, maximum observed drawdown, closed trades, win rate, fees, and comparisons to zero-interest USD cash and buying/holding EUR over the same period. The evaluation segment is a chronological research split, not independent evidence once repeatedly inspected. No parameters are fitted automatically.

Default assumed trading costs: 0.00010 total bid/ask spread, 0.00002 slippage per side, and $0.01 per order. These are configurable accounting assumptions, not broker quotes. Net trading P/L includes them. Realised/unrealised P/L excludes separately listed order fees. Wallet conversion remains illustrative at ₦1,600/USD and 0.5% each way; conversion costs are excluded from USD strategy returns. Cash baseline earns zero interest and is not a quoted savings product. Financing, real broker minimum sizes, and model API costs are not in the backtest.

## Code and tests

| File | Responsibility |
| --- | --- |
| `backend/market.js` | Reference/intraday adapters, completed-candle handling, CSV import |
| `backend/strategy.js` | Market validation and indicator-based decisions |
| `backend/paper.js` | Risk sizing, paper fills, stops, ledger, backtesting |
| `backend/ai.js` | Optional structured AI entry review |
| `backend/opay.js` | Staging-only OPay payment adapter, signature verification, durable references, and isolated test records |
| `backend/learning.js` | Features, labels, local model fitting, chronological evaluation, and learned decisions |
| `backend/research.js` | Persistent source-separated archive, correction tracking, and post-experiment predictions |
| `backend/service.js` | Serialized commands, automation, wallet accounting, atomic persistence |
| `server.js` | Local HTTP API and explicit public-file allowlist |
| `src/bot.js`, `src/bot.css`, `index.html` | Backend-connected dashboard |
| `tests/bot.test.js` | Strategy, risk, provider, AI, service, persistence, and API checks |
| `tests/learning.test.js` | Label purging, normalization, no-lookahead training, observer, registry, deployment, and migration checks |
| `opay.html`, `src/opay.js`, `src/opay.css` | Independent wallet host concept and merchant-integration lab |
| `tests/opay.test.js` | Payment signing, callbacks, reconciliation, idempotency, recovery, and trading-wallet isolation |

```sh
npm test
```

Tests use explicitly synthetic fixtures and mocked providers; they do not prove strategy performance or provider connectivity. To see each test's individual result directly:

```sh
node tests/bot.test.js
node tests/engine.test.js
```

State, archives, and the dashboard model registry live in git-ignored `.runtime/walletpilot.json`; updates use a temporary file and rename. Do not run multiple server processes against the same state file. Credentials belong in ignored `.env`, never in source. Reset deletes the active paper session and its baseline report while preserving archives, model experiments, and observer settings. This is local JSON persistence, not a production financial database or immutable ledger.

The original scripted wallet experience is retained at **/demo.html**, using `src/engine.js`, `src/app.js`, and `src/style.css`. Its virtual prices remain explicitly fictional and separate from the new backend.

## Remaining work before a banking product

Broker sandbox/order reconciliation; realistic instrument sizes and execution costs; wallet-provider sandbox integration; authentication and tenant/account separation; transactional financial storage and audit controls; full suitability assessment; independently evaluated strategies; provider/model cost evaluation; and the partner/regulatory arrangements described in IDEA.md. The current product cannot send real-money orders.

Development verification was limited by the execution environment: outbound DNS/provider requests and opening a local listening port were blocked. Adapter/HTTP behavior was checked through injected responses and direct handler tests; live connectivity and rendered-browser QA still need verification on a machine that permits them.
