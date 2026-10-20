# WalletPilot — AI trading inside a fintech wallet

Working name and concept draft, 19 October 2026. OPay is the illustrative host app; this is an independent proposal with no claimed OPay partnership or integration.

Implementation direction, 20 October 2026: the intended product is a market-connected trading bot embedded in a banking/fintech experience. The wallet interface is one part of that product. The repository now separates market ingestion, indicator-based strategy, optional AI entry review, independent risk controls, paper execution, and evaluation; see [README.md](README.md) for current capabilities and setup. The original scripted demo remains available separately. Real-money bank/broker integration and profitable performance have not been established. Growing a small allocation is an ambition to evaluate, not a promised outcome.

Training extension: the prototype now includes independent continuous observation, a persistent source-separated archive, a locally trained classifier, purged chronological training/validation/test evaluation, saved candidate models, and trained-model paper replay. Retraining creates candidates rather than silently changing the deployed strategy. Banking integration is deferred until the participant reviews this behavior and the evidence supports the intended next stage. The first saved real-data experiment failed screening; training functionality is not evidence of a profitable product.

Integration extension: the participant selected OPay as the target and authorized moving to the integration stage despite dissatisfaction with the current bot. The repository now includes an independent wallet host concept and a separate OPay Nigeria merchant-payment staging connector. This is not native access to OPay's app or customer balances, and payment tests do not fund the paper-trading account. See [OPAY_INTEGRATION.md](OPAY_INTEGRATION.md). Native embedding, investment funding, and payouts remain dependent on an agreed provider/partner scope; the strategy's failed screening result has not been bypassed.

## The opportunity

Let an eligible adult wallet user allocate a chosen amount of discretionary money to an AI-assisted forex strategy, with clear trade explanations, independent trading limits, and transparent performance after costs.

The original idea is to give wallet users another way to seek returns on money they choose to invest. The problem statement needs to acknowledge that OPay already offers OWealth, which pays daily interest. The proposed addition is access to a trading strategy within the wallet experience. Whether that strategy can outperform savings after costs remains an unproven hypothesis.

Trading puts principal at risk. It must be presented as a separate investment allocation, with variable gains and losses, rather than as savings interest or a guaranteed source of earnings. Money needed for bills, emergencies, or business operations should remain outside the trading allocation.

## The challenge

The registration form describes the **Talent Nation AI Rebuild Challenge**:

- Wednesday, 21 October 2026.
- Learn2Earn campuses in Lagos, Otukpo, Port Harcourt, and Ekiti.
- Free participation.
- Prizes at each campus: first ₦300,000; second ₦200,000; third ₦100,000.
- AI coding tools, APIs, and no-code tools are welcome; expert coding experience is not required.
- Registration does not automatically guarantee a competition place.

The form has three sections: participant details, team details, and the idea. It asks for experience level, Learn2Earn affiliation and Selection Game participation, consent, and an electronic signature. It does not publish a judging rubric, submission deadline, build duration, or demo submission requirements. Those details remain unverified.

## Ready-to-paste registration answers

### What would you like to rebuild with AI?

I want to reimagine the investment experience inside fintech apps, using OPay as an example. My idea is an optional AI trading section where users choose an amount from their wallet to allocate to a forex strategy. Users would set trading limits, see explanations for trade decisions, track gains and losses after fees, and request withdrawals of available funds. The AI would analyse market information and propose trades, while a separate rules engine would enforce the user's limits. For the challenge, I would build a paper-trading prototype using virtual money to demonstrate the experience. The goal is to explore accessible, transparent investing within a familiar app, while making clear that trading can lose money and returns are not guaranteed.

### Who would benefit most from your solution?

Adult fintech wallet users, including salaried workers and freelancers, who have discretionary funds and want an accessible way to understand and evaluate AI-assisted investing without managing a separate trading platform.

Participant identity, campus, team information, experience, consent, and signature must come from the participant; none have been supplied or submitted.

## Proposed demo

Use an OPay-inspired wallet journey with a clearly labelled independent concept and **virtual money / paper trading** status. The demo should show a complete decision and investment lifecycle, including a losing scenario.

1. **Wallet:** Start with an illustrative ₦100,000 virtual balance and open the AI trading section.
2. **Understand the product:** Explain potential losses and ask about investment experience, time horizon, and ability to bear losses. A user who cannot accept losses should not enter the trading flow.
3. **Allocate:** Move an illustrative ₦20,000 into the simulated trading account; ₦80,000 remains in the wallet. Show any simulated NGN-to-USD conversion, rate, and charge separately.
4. **Set controls:** Choose an allocation limit, position size limit, and a threshold for stopping new trades. Explain that a threshold is a trading instruction, not a guaranteed maximum loss.
5. **Observe a strategy:** Use one currency pair, such as EUR/USD, and a dated, identified market-data replay. Show buy, sell, and hold decisions with reasons. A separate rules engine can reject an AI proposal.
6. **See performance:** Show invested capital, available cash, open positions, realised and unrealised profit or loss, spread, fees, and net account value. Distinguish forex trading performance from NGN/USD currency movement.
7. **Demonstrate control:** Pause new orders, show a rejected order, and replay a loss scenario that triggers the configured stop procedure. Pausing new orders does not automatically close existing positions.
8. **Exit:** Close simulated positions and return available settled funds to the virtual wallet, displaying any conversion costs. A live product would need to explain execution and settlement timing.

For this demo, disable borrowing and leverage. Keep amounts, fees, and market movements clearly labelled as illustrative or historical, as applicable. A scripted demonstration shows product behaviour; it is not evidence of profitable trading.

## What the AI would do

- Read structured market observations, such as recent prices, trend indicators, volatility, and data timestamps.
- Propose a buy, sell, or hold decision and explain the supporting observations in plain language.
- Explain why the system skipped a trade or why a rule rejected it.
- Summarise actual ledger results rather than inventing returns or account balances.

The model must not hold wallet credentials or directly move money. A separate execution and accounting layer validates structured proposals, checks data freshness and position limits, and rejects invalid requests. If AI is unavailable or its output is invalid, the system places no new trade. Any scripted explanation must be labelled as a demonstration rather than a live AI response.

## Scope for the challenge

Build one polished journey: virtual wallet → suitability and allocation → strategy dashboard → trade explanation → stop procedure → withdrawal. Use one currency pair and one replay dataset. Demonstrate both a winning and losing trade and a hold decision.

The prototype can demonstrate usability, consent, bookkeeping, and control enforcement. Profitability would require separate evaluation on unseen data, realistic spread and execution costs, and subsequent forward paper trading. Compare results with an appropriate passive cash or savings baseline over the same period, including differences in risk and currency exposure.

## Path beyond a demo

Treat the initial commercial hypothesis as software that fintechs could embed through a negotiated partnership. Access to an existing customer's OPay balance is not established by this concept or by access to a payments API.

Before live trading, establish the applicable Nigerian regulatory route, whether the intended forex instruments and discretionary execution can be offered, the permissions of every partner, client-money custody, and the wallet provider's agreement. Nigeria's SEC publishes rules for robo-advisory services; those rules do not by themselves establish permission to offer this specific forex product.

## Pitch

“WalletPilot brings AI-assisted forex investing into the wallet experience. Users choose their allocation, understand each trading decision, and retain visible controls over the strategy. Our prototype uses virtual money to demonstrate the journey, including losses and the rules that stop new trades.”

## Sources

- [Challenge registration form](https://docs.google.com/forms/d/e/1FAIpQLSdMblpnNj2KSsYHdyEiu3Ty0AD_NioSSDjwC8Be4gdppUzJew/viewform): event details and all form questions inspected on 19 October 2026. No form response submitted.
- [OPay official website](https://www.opayweb.com/): describes OWealth and daily interest; no current universal interest rate is assumed here.
- [Nigeria SEC rules for fintechs](https://www.sec.gov.ng/our-mandate/regulation/rules-and-regulations/sec-rules-for-fintechs/): robo-advisory registration, algorithm oversight, and client-protection requirements.
- [CFTC advisory on AI trading bots](https://www.cftc.gov/LearnAndProtect/AdvisoriesAndArticles/AITradingBots.html): explains the limits of AI prediction and concerns with promised trading returns. This is a US investor-education source, not a statement of Nigerian law.
