# 提交发布审计

- 结果：377/377 checks passed
- 作品简介：458/500 字符
- PDF：17 页；官方 Skill 与 140/140 契约证据已进入二进制材料
- 视频：演示片 H.264 1280×800，26 秒；讲解片 H.264 1280×720，已检查格式与元数据
- V0.4 工程证据：Agent×Tool 策略、6/6 对抗安全、7 组对照/消融、OTLP JSON 导出均已纳入总包
- V0.5 工程证据：10 操作 OpenAPI、六类 HTTP Provider、控制面安全与 14/14 加固容器证据已纳入总包
- 云能力边界：官方 Skill 已锁定并随 Intake/RCA 分发；当前默认 Demo 未调用云账号

| Artifact | SHA-256 |
|---|---|
| DevOrbit_初赛方案.pdf | `3f9e2b10e3e199aa32a04948a544eee382815a287a121001d8f70fb961171fd4` |
| DevOrbit_初赛方案.pptx | `89ee37aab42cd76c466fc04eab9ed2574b0a5d593832ad43b6db7164c060cc68` |
| DevOrbit_初赛可执行代码包.zip | `9e909736af6565ef69cdf31814dbdc651bb2dff3aa66e41c23bdbc8fccbb7010` |
| DevOrbit_演示视频.mp4 | `f01f4bef22e5a7501c4aa89fa5341aa133e80c9a4d7c9ec518e827c1299b18fa` |
| DevOrbit_演示视频封面.png | `05787d13fb6591abafb83a3088a931a415ec07786025cc541db90263a2d7482e` |
| DevOrbit_初赛讲解视频_自动语音版.mp4 | `eed873e8ce9e857f35e18f375c3d701214f4135292a65fbf7f5c0ee017eb4dc7` |
| DevOrbit_威胁模型.pdf | `8da321f83478fee886d499c072f6707111206c8c068a3e2d84395ef5a75f8336` |
| DevOrbit_证据索引.pdf | `cc11595b288a872a3af8e6899ab94004a366586f23e234d1dc3daaab14e61be8` |
| DevOrbit_对照与消融评测.pdf | `67bb927e5345ebf0a3706bed6d076c6e2f3211b85bb78710e2c229dfae9b246d` |
| DevOrbit_对抗安全评测.pdf | `6fc3e9c5cf1cbcbeeb84ac4bf730b8090991d5b7c1d7ac755135e5a579f19b3a` |

| Check | Result | Detail |
|---|---|---|
| intro length | PASS | 458/500 chars |
| intro required claims | PASS |  |
| intro compliance | PASS |  |
| PDF page count | PASS |  |
| PDF official Skill evidence | PASS |  |
| PDF V0.4 evidence | PASS |  |
| PDF compliance | PASS |  |
| PPTX official Skill evidence | PASS |  |
| PPTX V0.4 evidence | PASS |  |
| PPTX compliance | PASS |  |
| video format | PASS |  |
| video duration | PASS | 26.000000s |
| video reviewed digest unchanged | PASS | f01f4bef22e5a750 |
| video metadata compliance | PASS |  |
| explainer video format | PASS |  |
| explainer video duration | PASS | 183.367000s |
| explainer metadata compliance | PASS |  |
| supporting PDF DevOrbit_Agent-Identity清单.pdf | PASS |  |
| supporting PDF DevOrbit_Skill清单.pdf | PASS |  |
| supporting PDF DevOrbit_工具与云产品清单.pdf | PASS |  |
| supporting PDF DevOrbit_威胁模型.pdf | PASS |  |
| supporting PDF DevOrbit_证据索引.pdf | PASS |  |
| supporting PDF DevOrbit_对照与消融评测.pdf | PASS |  |
| supporting PDF DevOrbit_对抗安全评测.pdf | PASS |  |
| code ZIP README.md | PASS |  |
| code ZIP LICENSE | PASS |  |
| code ZIP package.json | PASS |  |
| code ZIP Dockerfile | PASS |  |
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
| code ZIP scripts/release-audit.mjs | PASS |  |
| code ZIP cache free | PASS |  |
| code ZIP V0.5 version | PASS |  |
| code ZIP HTTP Adapter contract | PASS |  |
| code ZIP idempotency boundaries | PASS |  |
| code ZIP hardened container evidence | PASS |  |
| code ZIP intended base image digest | PASS |  |
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
| code compliance docs/提交清单.md | PASS |  |
| code compliance docs/路演PPT.html | PASS |  |
| code compliance docs/工具与云产品清单.md | PASS |  |
| code compliance docs/参赛方案.md | PASS |  |
| code compliance docs/第三方依赖与合规清单.md | PASS |  |
| code compliance docs/威胁模型.md | PASS |  |
| code compliance docs/证据索引.md | PASS |  |
| code compliance docs/自动解说视频说明.md | PASS |  |
| code compliance docs/Adapter生产契约.md | PASS |  |
| code compliance docs/复赛冲刺路线图.md | PASS |  |
| code compliance docs/评委90秒验收.md | PASS |  |
| code compliance docs/作品简介.md | PASS |  |
| code compliance docs/官网提交粘贴稿.md | PASS |  |
| code compliance docs/Skill清单.md | PASS |  |
| code compliance docs/Agent-Identity清单.md | PASS |  |
| code compliance docs/演示脚本.md | PASS |  |
| code compliance schemas/tool-contract.schema.json | PASS |  |
| code compliance schemas/http-adapter.openapi.json | PASS |  |
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
| code compliance scripts/mcp-smoke.mjs | PASS |  |
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
| code compliance scripts/evaluate-benchmark.mjs | PASS |  |
| code compliance scripts/evaluate-rag.mjs | PASS |  |
| code compliance scripts/render-agentteams-config.mjs | PASS |  |
| code compliance src/adapters/http.js | PASS |  |
| code compliance src/security/tool-policy.js | PASS |  |
| code compliance src/orchestrator.test.js | PASS |  |
| code compliance src/adapter-http.test.js | PASS |  |
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
| code compliance reports/rag-evaluation.json | PASS |  |
| code compliance reports/agentteams-contract.json | PASS |  |
| code compliance reports/container-smoke.json | PASS |  |
| code compliance reports/otel-happy-path.json | PASS |  |
| code compliance reports/evaluation.json | PASS |  |
| code compliance reports/security-evaluation.md | PASS |  |
| code compliance reports/benchmark.json | PASS |  |
| code compliance reports/agentteams-contract.md | PASS |  |
| code compliance reports/benchmark.md | PASS |  |
| code compliance reports/runs/test-failure.json | PASS |  |
| code compliance reports/runs/happy-path.json | PASS |  |
| code compliance reports/runs/canary-regression.json | PASS |  |
| code compliance reports/runs/low-confidence.json | PASS |  |
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
| total ZIP 交付物_SHA256.txt | PASS |  |
| total ZIP DevOrbit_初赛讲解视频_自动语音版.mp4 | PASS |  |
| total ZIP DevOrbit_Agent-Identity清单.pdf | PASS |  |
| total ZIP DevOrbit_Skill清单.pdf | PASS |  |
| total ZIP DevOrbit_工具与云产品清单.pdf | PASS |  |
| total ZIP DevOrbit_威胁模型.pdf | PASS |  |
| total ZIP DevOrbit_证据索引.pdf | PASS |  |
| total ZIP DevOrbit_对照与消融评测.pdf | PASS |  |
| total ZIP DevOrbit_对抗安全评测.pdf | PASS |  |
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
