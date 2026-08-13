# 提交发布审计

- 结果：474/474 checks passed
- 作品简介：458/500 字符
- PDF：17 页 V0.6.0；官方 Skill 与 140/140 契约证据已进入二进制材料
- 视频：演示片 H.264 1280×800，26 秒；讲解片 H.264 1280×720，已检查格式与元数据
- 基础工程证据：Agent×Tool 策略、6/6 对抗安全、7 组对照/消融、OTLP JSON 导出均已纳入总包
- V0.6.0 工程证据：原生连接器 8/8、native runner 6/6、普通容器 14/14、公开复现 pilot 8/8；正式公开分数仍为 0
- 云能力边界：官方 Skill 已锁定并随 Intake/RCA 分发；当前默认 Demo 未调用云账号

| Artifact | SHA-256 |
|---|---|
| DevOrbit_初赛方案.pdf | `e7b0b7fbd0cdd65c4bfb2e53e161848ae124f6d2f1f9aa34c3aaca66f9bf89e5` |
| DevOrbit_初赛方案.pptx | `60d4903656e38a9341312e7a9b1db1eb900eab089bbf70f3f8ed67dfc28725aa` |
| DevOrbit_初赛可执行代码包.zip | `132d81ed3aa5c4e0bea9465a858f5e6347ead421a41b1927c341db6f246fcb4b` |
| DevOrbit_演示视频.mp4 | `c86d6d4f1eff09835e3866edf76e4e4ca13a53b7280a2162d9b8a8a53b1eb327` |
| DevOrbit_演示视频封面.png | `05787d13fb6591abafb83a3088a931a415ec07786025cc541db90263a2d7482e` |
| DevOrbit_初赛讲解视频_自动语音版.mp4 | `123ef5a0cd7bf969cdd808eab56e1a3e1a13dff987895f7bbc6fca1840eafe6e` |
| DevOrbit_威胁模型.pdf | `12e03c80d0840cfc0dd8ed84ac1f8f3ae84f7f010f1cfc5fd50e3d25943dd769` |
| DevOrbit_证据索引.pdf | `6a72a1018e847fc884c97459f66cb295bf56e44e3a777d2d4027e0cdb43281ef` |
| DevOrbit_对照与消融评测.pdf | `e91a4c2eaa70c4aca233a4dce54a2c3344075fa25cf395c781a044f6e521f23a` |
| DevOrbit_对抗安全评测.pdf | `1b38388997a86c1fbca03a96b98cfac2d4a76232bb596a64e900896075814a43` |
| DevOrbit_公开基准复现试点.pdf | `8ce8afd2f6d58404edd2353ac652a7f4657d9a976b4774887060f3683f2cff7e` |

| Check | Result | Detail |
|---|---|---|
| intro length | PASS | 458/500 chars |
| intro required claims | PASS |  |
| intro compliance | PASS |  |
| PDF page count | PASS |  |
| PDF official Skill evidence | PASS |  |
| PDF V0.6.0 cover and evidence | PASS |  |
| PDF compliance | PASS |  |
| PPTX official Skill evidence | PASS |  |
| PPTX V0.6.0 cover and evidence | PASS |  |
| PPTX compliance | PASS |  |
| video format | PASS |  |
| video duration | PASS | 26.000000s |
| video reviewed digest unchanged | PASS | c86d6d4f1eff0983 |
| video metadata compliance | PASS |  |
| explainer video format | PASS |  |
| explainer AAC audio | PASS |  |
| explainer video duration | PASS | 190.367000s |
| explainer reviewed digest unchanged | PASS | 123ef5a0cd7bf969 |
| explainer metadata compliance | PASS |  |
| supporting PDF DevOrbit_Agent-Identity清单.pdf | PASS |  |
| supporting PDF DevOrbit_Skill清单.pdf | PASS |  |
| supporting PDF DevOrbit_工具与云产品清单.pdf | PASS |  |
| supporting PDF DevOrbit_威胁模型.pdf | PASS |  |
| supporting PDF DevOrbit_证据索引.pdf | PASS |  |
| supporting PDF DevOrbit_对照与消融评测.pdf | PASS |  |
| supporting PDF DevOrbit_对抗安全评测.pdf | PASS |  |
| supporting PDF DevOrbit_公开基准复现试点.pdf | PASS |  |
| code ZIP README.md | PASS |  |
| code ZIP LICENSE | PASS |  |
| code ZIP package.json | PASS |  |
| code ZIP Dockerfile | PASS |  |
| code ZIP Dockerfile.native | PASS |  |
| code ZIP .dockerignore | PASS |  |
| code ZIP config/agentteams.yaml | PASS |  |
| code ZIP config/tool-policy.json | PASS |  |
| code ZIP docs/威胁模型.md | PASS |  |
| code ZIP docs/证据索引.md | PASS |  |
| code ZIP docs/Adapter生产契约.md | PASS |  |
| code ZIP schemas/http-adapter.openapi.json | PASS |  |
| code ZIP src/adapters/http.js | PASS |  |
| code ZIP scripts/adapter-contract-smoke.mjs | PASS |  |
| code ZIP scripts/api-security-smoke.mjs | PASS |  |
| code ZIP scripts/container-smoke.sh | PASS |  |
| code ZIP config/aliyun-official-skill.contract.json | PASS |  |
| code ZIP third_party/aliyun/alibabacloud-sls-query-0.0.2-devorbit-curated.zip | PASS |  |
| code ZIP reports/agentteams-contract.md | PASS |  |
| code ZIP reports/benchmark.json | PASS |  |
| code ZIP reports/security-evaluation.json | PASS |  |
| code ZIP reports/otel-happy-path.json | PASS |  |
| code ZIP reports/container-smoke.json | PASS |  |
| code ZIP config/platform-native.contract.json | PASS |  |
| code ZIP schemas/platform-native.contract.schema.json | PASS |  |
| code ZIP docs/原生平台连接器.md | PASS |  |
| code ZIP reports/native-platform-smoke.json | PASS |  |
| code ZIP scripts/native-platform-smoke.mjs | PASS |  |
| code ZIP scripts/native-runner-smoke.sh | PASS |  |
| code ZIP scripts/write-native-runner-report.mjs | PASS |  |
| code ZIP scripts/reconcile-idempotency.mjs | PASS |  |
| code ZIP reports/native-runner-smoke.json | PASS |  |
| code ZIP src/adapters/platforms.js | PASS |  |
| code ZIP src/platform-adapters.test.js | PASS |  |
| code ZIP evaluation/public-benchmark.manifest.json | PASS |  |
| code ZIP reports/public-benchmark.json | PASS |  |
| code ZIP reports/public-benchmark.md | PASS |  |
| code ZIP schemas/public-benchmark.schema.json | PASS |  |
| code ZIP schemas/public-benchmark-results.schema.json | PASS |  |
| code ZIP schemas/public-benchmark-report.schema.json | PASS |  |
| code ZIP scripts/public-benchmark.mjs | PASS |  |
| code ZIP src/evaluation/public-benchmark.js | PASS |  |
| code ZIP src/evaluation/public-benchmark.test.js | PASS |  |
| code ZIP docs/公开基准协议.md | PASS |  |
| code ZIP evaluation/public-benchmark-pilot.manifest.json | PASS |  |
| code ZIP schemas/public-benchmark-pilot.schema.json | PASS |  |
| code ZIP docs/公开基准复现试点.md | PASS |  |
| code ZIP reports/public-benchmark-pilot.json | PASS |  |
| code ZIP evaluation/public-pilot/sqlfluff__sqlfluff-884/test.patch | PASS |  |
| code ZIP evaluation/public-pilot/sqlfluff__sqlfluff-884/requirements.lock | PASS |  |
| code ZIP evaluation/public-pilot/sqlfluff__sqlfluff-884/evidence/baseline-normalized.log | PASS |  |
| code ZIP evaluation/public-pilot/sqlfluff__sqlfluff-884/evidence/gold-fail-to-pass-normalized.log | PASS |  |
| code ZIP evaluation/public-pilot/sqlfluff__sqlfluff-884/evidence/gold-ansi-file-normalized.log | PASS |  |
| code ZIP scripts/validate-public-pilot.mjs | PASS |  |
| code ZIP scripts/reproduce-public-pilot.sh | PASS |  |
| code ZIP scripts/release-audit.mjs | PASS |  |
| code ZIP cache free | PASS |  |
| code ZIP V0.6.0 version | PASS |  |
| code ZIP HTTP Adapter contract | PASS |  |
| code ZIP idempotency boundaries | PASS |  |
| code ZIP hardened container evidence | PASS |  |
| code ZIP intended base image digest | PASS |  |
| code ZIP public benchmark is protocol-only | PASS |  |
| code ZIP public benchmark digest binding | PASS |  |
| code ZIP public pilot is reproduced but unscored | PASS |  |
| code ZIP public pilot audit report | PASS |  |
| code ZIP public pilot test patch digest | PASS |  |
| code ZIP public pilot requirements digest | PASS |  |
| code ZIP public pilot baselineLogPath | PASS |  |
| code ZIP public pilot goldFailToPassLogPath | PASS |  |
| code ZIP public pilot goldAnsiFileLogPath | PASS |  |
| code ZIP native platform contract | PASS |  |
| code ZIP native platform evidence | PASS |  |
| code ZIP native runner evidence | PASS |  |
| nested official Skill digest | PASS |  |
| nested official Skill compliance | PASS |  |
| official Skill curation disclosed | PASS |  |
| intake-worker contains official Skill | PASS |  |
| rca-worker contains official Skill | PASS |  |
| code compliance README.md | PASS |  |
| code compliance package.json | PASS |  |
| code compliance server.js | PASS |  |
| code compliance app/approval.css | PASS |  |
| code compliance app/style.css | PASS |  |
| code compliance app/app.js | PASS |  |
| code compliance app/index.html | PASS |  |
| code compliance config/agentteams.yaml | PASS |  |
| code compliance config/case-lifecycle.yaml | PASS |  |
| code compliance config/aliyun-official-skill.contract.json | PASS |  |
| code compliance config/agentteams.resources.json | PASS |  |
| code compliance config/agentteams-v1.2.2.contract.json | PASS |  |
| code compliance config/policy.yaml | PASS |  |
| code compliance config/tool-policy.json | PASS |  |
| code compliance config/platform-native.contract.json | PASS |  |
| code compliance docs/提交清单.md | PASS |  |
| code compliance docs/路演PPT.html | PASS |  |
| code compliance docs/工具与云产品清单.md | PASS |  |
| code compliance docs/参赛方案.md | PASS |  |
| code compliance docs/第三方依赖与合规清单.md | PASS |  |
| code compliance docs/威胁模型.md | PASS |  |
| code compliance docs/证据索引.md | PASS |  |
| code compliance docs/自动解说视频说明.md | PASS |  |
| code compliance docs/Adapter生产契约.md | PASS |  |
| code compliance docs/原生平台连接器.md | PASS |  |
| code compliance docs/复赛冲刺路线图.md | PASS |  |
| code compliance docs/评委90秒验收.md | PASS |  |
| code compliance docs/公开基准协议.md | PASS |  |
| code compliance docs/作品简介.md | PASS |  |
| code compliance docs/公开基准复现试点.md | PASS |  |
| code compliance docs/官网提交粘贴稿.md | PASS |  |
| code compliance docs/Skill清单.md | PASS |  |
| code compliance docs/Agent-Identity清单.md | PASS |  |
| code compliance docs/演示脚本.md | PASS |  |
| code compliance schemas/public-benchmark.schema.json | PASS |  |
| code compliance schemas/platform-native.contract.schema.json | PASS |  |
| code compliance schemas/public-benchmark-results.schema.json | PASS |  |
| code compliance schemas/public-benchmark-report.schema.json | PASS |  |
| code compliance schemas/tool-contract.schema.json | PASS |  |
| code compliance schemas/http-adapter.openapi.json | PASS |  |
| code compliance schemas/public-benchmark-pilot.schema.json | PASS |  |
| code compliance schemas/case-state.schema.json | PASS |  |
| code compliance skills/signal-fusion/SKILL.md | PASS |  |
| code compliance skills/signal-fusion/agents/openai.yaml | PASS |  |
| code compliance skills/evidence-rca/SKILL.md | PASS |  |
| code compliance skills/evidence-rca/agents/openai.yaml | PASS |  |
| code compliance skills/patch-plan/SKILL.md | PASS |  |
| code compliance skills/patch-plan/agents/openai.yaml | PASS |  |
| code compliance skills/knowledge-card/SKILL.md | PASS |  |
| code compliance skills/knowledge-card/agents/openai.yaml | PASS |  |
| code compliance skills/test-gate/SKILL.md | PASS |  |
| code compliance skills/test-gate/agents/openai.yaml | PASS |  |
| code compliance skills/impact-map/SKILL.md | PASS |  |
| code compliance skills/impact-map/agents/openai.yaml | PASS |  |
| code compliance skills/release-guard/SKILL.md | PASS |  |
| code compliance skills/release-guard/agents/openai.yaml | PASS |  |
| code compliance scripts/adapter-contract-smoke.mjs | PASS |  |
| code compliance scripts/evaluate-security.mjs | PASS |  |
| code compliance scripts/evaluate.mjs | PASS |  |
| code compliance scripts/native-platform-smoke.mjs | PASS |  |
| code compliance scripts/mcp-smoke.mjs | PASS |  |
| code compliance scripts/reconcile-idempotency.mjs | PASS |  |
| code compliance scripts/release-audit.mjs | PASS |  |
| code compliance scripts/validate.mjs | PASS |  |
| code compliance scripts/capture-run.mjs | PASS |  |
| code compliance scripts/export-otel.mjs | PASS |  |
| code compliance scripts/compliance.mjs | PASS |  |
| code compliance scripts/container-smoke.mjs | PASS |  |
| code compliance scripts/validate-adapter-contract.mjs | PASS |  |
| code compliance scripts/api-smoke.mjs | PASS |  |
| code compliance scripts/api-security-smoke.mjs | PASS |  |
| code compliance scripts/validate-agentteams.mjs | PASS |  |
| code compliance scripts/firefox-demo-user.js | PASS |  |
| code compliance scripts/write-deliverable-checksums.mjs | PASS |  |
| code compliance scripts/public-benchmark.mjs | PASS |  |
| code compliance scripts/evaluate-benchmark.mjs | PASS |  |
| code compliance scripts/write-native-runner-report.mjs | PASS |  |
| code compliance scripts/evaluate-rag.mjs | PASS |  |
| code compliance scripts/render-agentteams-config.mjs | PASS |  |
| code compliance scripts/validate-public-pilot.mjs | PASS |  |
| code compliance src/adapters/http.js | PASS |  |
| code compliance src/adapters/platforms.js | PASS |  |
| code compliance src/security/tool-policy.js | PASS |  |
| code compliance src/orchestrator.test.js | PASS |  |
| code compliance src/adapter-http.test.js | PASS |  |
| code compliance src/platform-adapters.test.js | PASS |  |
| code compliance src/agents/learning-agent.js | PASS |  |
| code compliance src/agents/impact-agent.js | PASS |  |
| code compliance src/agents/release-agent.js | PASS |  |
| code compliance src/agents/rca-agent.js | PASS |  |
| code compliance src/agents/patch-agent.js | PASS |  |
| code compliance src/agents/verify-agent.js | PASS |  |
| code compliance src/agents/intake-agent.js | PASS |  |
| code compliance src/agents/index.js | PASS |  |
| code compliance src/runtime/test-runner.js | PASS |  |
| code compliance src/runtime/case-state.js | PASS |  |
| code compliance src/runtime/digest.js | PASS |  |
| code compliance src/runtime/trace.js | PASS |  |
| code compliance src/runtime/manager.js | PASS |  |
| code compliance src/adapters.js | PASS |  |
| code compliance src/knowledge/store.js | PASS |  |
| code compliance src/skills.js | PASS |  |
| code compliance src/observability/otel.js | PASS |  |
| code compliance src/mcp/http-transport.js | PASS |  |
| code compliance src/mcp/client.js | PASS |  |
| code compliance src/mcp/protocol.js | PASS |  |
| code compliance src/mcp/tool-server.js | PASS |  |
| code compliance src/mcp/tools.js | PASS |  |
| code compliance src/evaluation/public-benchmark.js | PASS |  |
| code compliance src/evaluation/public-benchmark.test.js | PASS |  |
| code compliance src/orchestrator.js | PASS |  |
| code compliance src/version.js | PASS |  |
| code compliance src/security-policy.test.js | PASS |  |
| code compliance fixtures/checkout-service/src/redisPool.js | PASS |  |
| code compliance fixtures/checkout-service/src/order.js | PASS |  |
| code compliance fixtures/checkout-service/test/order.test.js | PASS |  |
| code compliance fixtures/checkout-service/test/redisPool.test.js | PASS |  |
| code compliance fixtures/checkout-service/package.json | PASS |  |
| code compliance knowledge/cases.json | PASS |  |
| code compliance evaluation/golden-cases.json | PASS |  |
| code compliance evaluation/rag-cases.json | PASS |  |
| code compliance evaluation/public-benchmark.manifest.json | PASS |  |
| code compliance evaluation/public-benchmark-pilot.manifest.json | PASS |  |
| code compliance reports/rag-evaluation.json | PASS |  |
| code compliance reports/agentteams-contract.json | PASS |  |
| code compliance reports/container-smoke.json | PASS |  |
| code compliance reports/otel-happy-path.json | PASS |  |
| code compliance reports/public-benchmark.json | PASS |  |
| code compliance reports/evaluation.json | PASS |  |
| code compliance reports/security-evaluation.md | PASS |  |
| code compliance reports/benchmark.json | PASS |  |
| code compliance reports/public-benchmark-pilot.json | PASS |  |
| code compliance reports/agentteams-contract.md | PASS |  |
| code compliance reports/benchmark.md | PASS |  |
| code compliance reports/native-runner-smoke.json | PASS |  |
| code compliance reports/native-platform-smoke.json | PASS |  |
| code compliance reports/runs/test-failure.json | PASS |  |
| code compliance reports/runs/happy-path.json | PASS |  |
| code compliance reports/runs/canary-regression.json | PASS |  |
| code compliance reports/runs/low-confidence.json | PASS |  |
| code compliance reports/public-benchmark.md | PASS |  |
| code compliance reports/security-evaluation.json | PASS |  |
| code compliance reports/rag-evaluation.md | PASS |  |
| code compliance reports/evaluation.md | PASS |  |
| code compliance worker-packages/patch-worker/manifest.json | PASS |  |
| code compliance worker-packages/patch-worker/config/SOUL.md | PASS |  |
| code compliance worker-packages/patch-worker/config/AGENTS.md | PASS |  |
| code compliance worker-packages/patch-worker/skills/patch-plan/SKILL.md | PASS |  |
| code compliance worker-packages/patch-worker/skills/patch-plan/openai.yaml | PASS |  |
| code compliance worker-packages/impact-worker/manifest.json | PASS |  |
| code compliance worker-packages/impact-worker/config/SOUL.md | PASS |  |
| code compliance worker-packages/impact-worker/config/AGENTS.md | PASS |  |
| code compliance worker-packages/impact-worker/skills/impact-map/SKILL.md | PASS |  |
| code compliance worker-packages/impact-worker/skills/impact-map/openai.yaml | PASS |  |
| code compliance worker-packages/release-worker/manifest.json | PASS |  |
| code compliance worker-packages/release-worker/config/SOUL.md | PASS |  |
| code compliance worker-packages/release-worker/config/AGENTS.md | PASS |  |
| code compliance worker-packages/release-worker/skills/release-guard/SKILL.md | PASS |  |
| code compliance worker-packages/release-worker/skills/release-guard/openai.yaml | PASS |  |
| code compliance worker-packages/README.md | PASS |  |
| code compliance worker-packages/templates/manifest.json | PASS |  |
| code compliance worker-packages/templates/SOUL.md | PASS |  |
| code compliance worker-packages/templates/AGENTS.md | PASS |  |
| code compliance worker-packages/learning-worker/manifest.json | PASS |  |
| code compliance worker-packages/learning-worker/config/SOUL.md | PASS |  |
| code compliance worker-packages/learning-worker/config/AGENTS.md | PASS |  |
| code compliance worker-packages/learning-worker/skills/knowledge-card/SKILL.md | PASS |  |
| code compliance worker-packages/learning-worker/skills/knowledge-card/openai.yaml | PASS |  |
| code compliance worker-packages/intake-worker/manifest.json | PASS |  |
| code compliance worker-packages/intake-worker/config/SOUL.md | PASS |  |
| code compliance worker-packages/intake-worker/config/AGENTS.md | PASS |  |
| code compliance worker-packages/intake-worker/skills/signal-fusion/SKILL.md | PASS |  |
| code compliance worker-packages/intake-worker/skills/signal-fusion/openai.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/SKILL.md | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/cli-installation-guide.md | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/ram-policies.md | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/query_analysis/indexConfig.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/query_analysis/sql.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/query_analysis/indexSearch.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/query_analysis/overview.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/conversion.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/array.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/hash.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/geospatial.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/bitwise.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/math.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/url.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/README.md | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/operators.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/binary.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/conditional.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/aggregate.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/lambda.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/ip_geo.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/window_funnel.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/datetime.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/map.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/approximate.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/json.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/statistical.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/encoding.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/color.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/type_conversion.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/comparison.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/string.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/regex.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/geo.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/overview.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/window.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions/hyperloglog.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/regions.md | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/functions-guide.md | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/query-analysis.md | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/acceptance-criteria.md | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/spl-guide.md | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/troubleshooting.md | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/related-apis.md | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/spl/limit.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/spl/where.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/spl/stats.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/spl/project.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/spl/parse-json.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/spl/project-away.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/spl/json_string_process.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/spl/parse-csv.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/spl/parse-kv.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/spl/parse-regexp.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/spl/sort.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/spl/pack-fields.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/spl/extend.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/spl/project-rename.yaml | PASS |  |
| code compliance worker-packages/intake-worker/skills/alibabacloud-sls-query/references/spl/overview.yaml | PASS |  |
| code compliance worker-packages/rca-worker/manifest.json | PASS |  |
| code compliance worker-packages/rca-worker/config/SOUL.md | PASS |  |
| code compliance worker-packages/rca-worker/config/AGENTS.md | PASS |  |
| code compliance worker-packages/rca-worker/skills/evidence-rca/SKILL.md | PASS |  |
| code compliance worker-packages/rca-worker/skills/evidence-rca/openai.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/SKILL.md | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/cli-installation-guide.md | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/ram-policies.md | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/query_analysis/indexConfig.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/query_analysis/sql.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/query_analysis/indexSearch.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/query_analysis/overview.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/conversion.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/array.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/hash.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/geospatial.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/bitwise.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/math.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/url.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/README.md | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/operators.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/binary.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/conditional.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/aggregate.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/lambda.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/ip_geo.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/window_funnel.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/datetime.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/map.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/approximate.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/json.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/statistical.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/encoding.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/color.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/type_conversion.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/comparison.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/string.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/regex.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/geo.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/overview.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/window.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions/hyperloglog.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/regions.md | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/functions-guide.md | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/query-analysis.md | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/acceptance-criteria.md | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/spl-guide.md | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/troubleshooting.md | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/related-apis.md | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/spl/limit.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/spl/where.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/spl/stats.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/spl/project.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/spl/parse-json.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/spl/project-away.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/spl/json_string_process.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/spl/parse-csv.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/spl/parse-kv.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/spl/parse-regexp.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/spl/sort.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/spl/pack-fields.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/spl/extend.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/spl/project-rename.yaml | PASS |  |
| code compliance worker-packages/rca-worker/skills/alibabacloud-sls-query/references/spl/overview.yaml | PASS |  |
| code compliance worker-packages/verify-worker/manifest.json | PASS |  |
| code compliance worker-packages/verify-worker/config/SOUL.md | PASS |  |
| code compliance worker-packages/verify-worker/config/AGENTS.md | PASS |  |
| code compliance worker-packages/verify-worker/skills/test-gate/SKILL.md | PASS |  |
| code compliance worker-packages/verify-worker/skills/test-gate/openai.yaml | PASS |  |
| code compliance third_party/aliyun/README.md | PASS |  |
| total ZIP DevOrbit_初赛方案.pdf | PASS |  |
| total ZIP DevOrbit_初赛方案.pptx | PASS |  |
| total ZIP DevOrbit_初赛可执行代码包.zip | PASS |  |
| total ZIP DevOrbit_演示视频.mp4 | PASS |  |
| total ZIP DevOrbit_演示视频封面.png | PASS |  |
| total ZIP 作品简介.md | PASS |  |
| total ZIP 官网提交粘贴稿.md | PASS |  |
| total ZIP 提交清单.md | PASS |  |
| total ZIP 评委90秒验收.md | PASS |  |
| total ZIP 第三方依赖与合规清单.md | PASS |  |
| total ZIP 演示脚本.md | PASS |  |
| total ZIP 威胁模型.md | PASS |  |
| total ZIP 证据索引.md | PASS |  |
| total ZIP Adapter生产契约.md | PASS |  |
| total ZIP agentteams-contract.md | PASS |  |
| total ZIP benchmark.md | PASS |  |
| total ZIP security-evaluation.md | PASS |  |
| total ZIP container-smoke.json | PASS |  |
| total ZIP http-adapter.openapi.json | PASS |  |
| total ZIP public-benchmark.manifest.json | PASS |  |
| total ZIP public-benchmark.json | PASS |  |
| total ZIP public-benchmark.md | PASS |  |
| total ZIP public-benchmark.schema.json | PASS |  |
| total ZIP public-benchmark-results.schema.json | PASS |  |
| total ZIP public-benchmark-report.schema.json | PASS |  |
| total ZIP 公开基准协议.md | PASS |  |
| total ZIP public-benchmark-pilot.manifest.json | PASS |  |
| total ZIP public-benchmark-pilot.schema.json | PASS |  |
| total ZIP 公开基准复现试点.md | PASS |  |
| total ZIP public-benchmark-pilot.json | PASS |  |
| total ZIP platform-native.contract.json | PASS |  |
| total ZIP platform-native.contract.schema.json | PASS |  |
| total ZIP 原生平台连接器.md | PASS |  |
| total ZIP native-platform-smoke.json | PASS |  |
| total ZIP Dockerfile.native | PASS |  |
| total ZIP native-runner-smoke.sh | PASS |  |
| total ZIP write-native-runner-report.mjs | PASS |  |
| total ZIP native-runner-smoke.json | PASS |  |
| total ZIP 交付物_SHA256.txt | PASS |  |
| total ZIP DevOrbit_初赛讲解视频_自动语音版.mp4 | PASS |  |
| total ZIP DevOrbit_Agent-Identity清单.pdf | PASS |  |
| total ZIP DevOrbit_Skill清单.pdf | PASS |  |
| total ZIP DevOrbit_工具与云产品清单.pdf | PASS |  |
| total ZIP DevOrbit_威胁模型.pdf | PASS |  |
| total ZIP DevOrbit_证据索引.pdf | PASS |  |
| total ZIP DevOrbit_对照与消融评测.pdf | PASS |  |
| total ZIP DevOrbit_对抗安全评测.pdf | PASS |  |
| total ZIP DevOrbit_公开基准复现试点.pdf | PASS |  |
| total ZIP embeds current code ZIP | PASS |  |
| total compliance 交付物_SHA256.txt | PASS |  |
| total compliance 作品简介.md | PASS |  |
| total compliance 官网提交粘贴稿.md | PASS |  |
| total compliance 提交清单.md | PASS |  |
| total compliance 评委90秒验收.md | PASS |  |
| total compliance 第三方依赖与合规清单.md | PASS |  |
| total compliance 演示脚本.md | PASS |  |
| total compliance 威胁模型.md | PASS |  |
| total compliance 证据索引.md | PASS |  |
| total compliance Adapter生产契约.md | PASS |  |
| total compliance agentteams-contract.md | PASS |  |
| total compliance benchmark.md | PASS |  |
| total compliance security-evaluation.md | PASS |  |
| total compliance public-benchmark.md | PASS |  |
| total compliance 公开基准协议.md | PASS |  |
| total compliance 公开基准复现试点.md | PASS |  |
| total compliance 原生平台连接器.md | PASS |  |
