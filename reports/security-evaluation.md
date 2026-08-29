# DevOrbit 对抗安全评测

> Deterministic local attack simulations. Identity authentication remains a production gateway responsibility; this benchmark validates authorization, approval integrity, scope, expiry, schema enforcement, evidence-chain integrity, branch isolation, and migration gate enforcement.

- 结果：9/9
- 策略拒绝审计：6

| Case | Attack | Expected control | Observed | Result |
|---|---|---|---|---|
| SEC-001 | unauthorized agent invokes release | agent rca-worker is not allowed to call release.canary | agent rca-worker is not allowed to call release.canary | PASS |
| SEC-002 | forged approval receipt | invalid approval signature | invalid approval signature | PASS |
| SEC-003 | approval replay across cases | case scope mismatch | case scope mismatch | PASS |
| SEC-004 | approval scope tampering | approval scope mismatch | approval scope mismatch | PASS |
| SEC-005 | expired approval receipt | approval expired | approval expired | PASS |
| SEC-006 | schema confusion with unknown argument | Invalid tool arguments: $ has unknown command | Invalid tool arguments: $ has unknown command | PASS |
| SEC-007 | evidence chain stageHash tamper | evidence chain tamper detected | evidence chain tamper detected | PASS |
| SEC-008 | db migration cross-branch write | case scope mismatch | case scope mismatch | PASS |
| SEC-009 | malicious migration drops table | migration gate rejected DROP TABLE | migration gate rejected DROP TABLE | PASS |
