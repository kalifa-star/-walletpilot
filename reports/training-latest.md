# Real-data training experiment

Generated 2026-10-20T02:20:03.213Z. Research only; no active model or paper account was changed.

Source: Frankfurter / ECB (1day), 2025-04-17 through 2026-10-19. Dataset SHA-256: 70f4891d7a0a6772430e601686638ffeccb2be9d85fbb0146e2a1b3884ee1578.

Model: logistic-regression-v1, seven price-derived features. Virtual allocation: ₦20000; USD capital after conversion: $12.4375.

Training, validation, and test are chronological (60/20/20), with five-observation label purges. Labelled examples: 205 / 72 / 72. Normalization uses training examples only; validation selects the 70% entry threshold.

| Held-out test result | Value |
| --- | ---: |
| Trained strategy net return | +0.00% |
| Fixed-rule baseline, same period/capital | -0.98% |
| Zero-interest USD cash | 0.00% |
| Buy and hold EUR | -2.12% |
| Closed trades | 0 |
| Assumed order fees | $0.00 |
| Max drawdown | 0.00% |
| Test Brier / constant-prediction baseline | 0.1787 / 0.1723 |

Screening: **not passed; remains a research candidate**.

- FAIL: Test net return must exceed zero-interest cash.
- PASS: Test return must exceed the fixed-rule baseline.
- FAIL: At least five closed test trades are required.
- PASS: Test drawdown must remain below the configured account stop.
- FAIL: Test Brier score must beat the training-prevalence predictor.

Screening gate for experimental paper deployment only. One historical test does not establish profitability. Repeated inspection or retraining can overfit this test period. Positive net hypothetical long trade: next observation open to fifth observation close; fixed maximum-position notional, assumed round-trip costs. Actual risk-managed executions can differ. Daily fixings cannot establish realistic intraday execution. Assumed spread, slippage, and fees apply; NGN conversion charges and model API costs are excluded. The test horizon overlaps across examples, so observations are not independent.

This offline artifact is saved under .runtime/candidates and is not automatically registered, promoted, or traded. Use Train & evaluate in the restarted dashboard to create the corresponding registry candidate.
