# DevOrbit 对抗安全评测

> Deterministic local attack simulations. Identity authentication remains a production gateway responsibility; this benchmark validates authorization, approval integrity, scope, expiry, and schema enforcement.

- 结果：6/6
- 策略拒绝审计：5

| Case | Attack | Expected control | Observed | Result |
|---|---|---|---|---|
| SEC-001 | unauthorized agent invokes release | agent rca-worker is not allowed to call release.canary | agent rca-worker is not allowed to call release.canary | PASS |
| SEC-002 | forged approval receipt | invalid approval signature | invalid approval signature | PASS |
| SEC-003 | approval replay across cases | case scope mismatch | case scope mismatch | PASS |
| SEC-004 | approval scope tampering | approval scope mismatch | approval scope mismatch | PASS |
| SEC-005 | expired approval receipt | approval expired | approval expired | PASS |
| SEC-006 | schema confusion with unknown argument | Invalid tool arguments: $ has unknown command | Invalid tool arguments: $ has unknown command | PASS |
