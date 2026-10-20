# WalletPilot × OPay integration

OPay Nigeria is the selected integration target. This repository does not modify or run inside the real OPay app. It contains an independent host-experience concept and a merchant-payment connector limited to local mock / OPay staging modes. No production endpoint, customer-wallet credential flow, real investment funding, or bank payout is implemented.

## Review locally

Restart the existing server, then open **http://localhost:3000/opay**:

```sh
npm run dev
```

The page has three working views:

- **Wallet overview:** reads the same local virtual wallet and paper account used by the trading terminal. It supports virtual allocation and returning available virtual funds.
- **AI trading:** native paper controls plus the actual WalletPilot terminal embedded in our own concept page. Existing strategy and model-screening restrictions remain in force.
- **OPay integration lab:** creates, inspects, simulates, and reconciles separate payment-test records. This view does not claim a connection to an OPay customer wallet.

Existing balances/positions are preserved on upgrade. Starting/restarting the server pauses trading automation as before. Resetting the virtual trading session preserves research archives, models, and the separate payment-test records.

## Local mock mode

The default is:

```dotenv
OPAY_MODE=mock
```

No merchant account or external payment call is needed. In **OPay integration lab**, create a ₦100 test payment. It starts pending. Use **Simulate success**, **Simulate failure**, or **Simulate close**, then **Reconcile status**. Finalized results cannot be rewritten into a different result. Create another reference for another case.

The displayed virtual wallet never changes because of a payment-test result. Paper withdrawals are not OPay payouts. Mock results are always labelled local simulation; they do not demonstrate provider connectivity.

## OPay staging mode

Obtain staging merchant credentials through [OPay merchant onboarding](https://documentation.opaycheckout.com/getting-started). Merchant onboarding is distinct from having a personal wallet. No signup or provider contact has been performed by this project.

Copy `.env.example` to `.env` and configure on the server:

```dotenv
OPAY_MODE=sandbox
OPAY_MERCHANT_ID=your_staging_merchant_id
OPAY_PRIVATE_KEY=your_staging_private_key
OPAY_PUBLIC_KEY=your_staging_public_key
OPAY_STATUS_AUTH=public
```

Restart the server and inspect the lab's configuration state. Keys never belong in browser forms or source control. The implementation does not collect OPay passwords, PINs, or OTPs.

The connector follows the documented [Nigeria wallet QR payment flow](https://documentation.opaycheckout.com/opay-wallet-payment): NGN amounts use integer minor units, payment method `OpayWalletNgQR`, and a server-generated merchant reference. It sends only to `https://testapi.opaycheckout.com`, with redirects disabled. The integration test product is not represented as an investment subscription. A returned QR destination is exposed only when it is HTTPS on an allowed OPay-related domain.

Supported upstream operations:

| Operation | Staging path |
| --- | --- |
| Wallet QR payment creation | `/api/v1/international/payment/create` |
| Transaction status query | `/api/v1/international/cashier/status` |

Outbound requests use a deterministic, recursively sorted JSON body; creation signs exactly that body with HMAC-SHA512 and sends the merchant header. See [OPay request authentication](https://documentation.opaycheckout.com/api-signature).

The authentication documentation specifies the public key for cashier-status calls, while some [status-query examples](https://documentation.opaycheckout.com/query-payment-status) show request-signature authorization. The default is explicitly `OPAY_STATUS_AUTH=public`. If OPay confirms HMAC for your staging merchant's contract, select `OPAY_STATUS_AUTH=hmac`. There is no silent authentication fallback. The merchant may also need OPay to enable the wallet payment method. These details need verification against the actual staging account.

Live payment hosts are not implemented and `OPAY_MODE=live` is rejected. Staging records remain separate from trading balances even after successful provider reconciliation.

## Callback verification and reconciliation

Manual status queries work without a public callback endpoint. For provider callback testing, supply a reachable URL:

```dotenv
OPAY_CALLBACK_URL=https://your-staging-domain.example/api/opay/callback
```

The URL must be HTTPS, use the exact callback path, and contain no credentials/query parameters. A provider cannot call your localhost directly. Route **only** this path through your staging reverse proxy; the server continues binding to loopback and rejects other routes under the configured public callback host. Do not publish the unauthenticated local workspace as a banking service.

The callback verifier implements the distinct HMAC-SHA3-512 field format from [OPay's callback-signature specification](https://documentation.opaycheckout.com/callback-signature), including the documented `t`/`f` refund representation. It uses a timing-safe signature comparison and checks the stored reference, NGN amount, transaction identity, country, and non-refund status. The test suite includes OPay's published signature vector and published example key; these are public test examples, not merchant credentials.

A valid signature is followed by an independent status query before recording the provider result. Duplicate callbacks are deduplicated. A disagreement keeps the queried result; conflicting finalized states are flagged for manual reconciliation. Invalid/unreconciled callbacks receive a non-2xx response so they are not acknowledged as processed. This follows the independent-verification and acknowledgement behavior described in [OPay's callback guide](https://documentation.opaycheckout.com/payment-notifications-callbacks). Callback delivery/authentication still requires end-to-end validation with your merchant account.

## Request identity and persistence

Each creation requires an idempotency `requestId`; the provider reference is generated on the server. The intent is saved **before** contacting OPay. Reusing the same request ID returns its existing order, while reuse with a different amount or mode is rejected. A failed/uncertain request keeps its reference; reconciliation queries that reference rather than blindly creating another order.

If the server restarts during creation, the saved order becomes `UNKNOWN` and requires reconciliation. Provider calls cannot be rolled back, so a local persistence error never causes an automatic duplicate creation. Callback/status results must match the saved reference, amount, currency, and OPay order number.

Integration state is stored separately in ignored `.runtime/opay-integration.json`. Updates use a temporary file and rename, with commands serialized inside one server process. Do not run multiple writers against that file. The local lab retains at most 100 payment intents and bounded per-order event/digest histories; it is not a production payment database or immutable financial ledger.

Local HTTP routes:

| Route | Purpose |
| --- | --- |
| `GET /api/opay/status` | Configuration flags and saved test orders; no keys |
| `POST /api/opay/payments/create` | `{amount, consent: true, requestId}` |
| `POST /api/opay/payments/query` | `{reference}` |
| `POST /api/opay/payments/simulate` | `{reference, status}`; local mock only |
| `POST /api/opay/callback` | Signed provider callback; sandbox only |

Creation/reconciliation is not wired to `/api/allocate` or `/api/withdraw`. That separation prevents a test payment from being presented as customer principal backing paper-generated investment returns.

## What is still needed for native OPay integration

The reviewed public APIs document merchant payments. They do not establish permission to insert WalletPilot into OPay's app, read arbitrary customers' balances, debit investment allocations, or pay trading proceeds back to wallets. Those capabilities need an OPay-approved partnership scope and technical contract, together with the broker/custody, account identity, and investment permissions described in IDEA.md. A merchant account alone is not evidence that the trading product is approved.

The current model's failed screening result remains visible. This integration work does not establish trading profitability or readiness for real customer funds.

## Verification

```sh
node tests/opay.test.js
npm test
```

Tests cover signing, amount precision, fixed staging hosts, credential isolation, mock outcomes, duplicate requests, uncertain responses, restart recovery, callback authentication/deduplication, independent queries, and trading-wallet isolation. No real merchant key or external payment call was used. Provider connectivity, method enablement, and the rendered host-page flow still require local/staging verification.
