# Official cloud Skill snapshot

`alibabacloud-sls-query-0.0.2-devorbit-curated.zip` is the distributable snapshot derived from the official Agent Skills portal archive. The portal archive SHA-256, curated archive SHA-256, unchanged `SKILL.md` SHA-256, source, version, integration boundary and license disclosure are locked in `config/aliyun-official-skill.contract.json`.

The only curation is removal of `references/functions/mobile.yaml`, an unrelated function reference that violates this submission's content policy. The core `SKILL.md` and SLS query references are unchanged. The original portal archive is not redistributed; its digest remains recorded so the derivation can be audited.

The build copies this Skill into the `intake-worker` and `rca-worker` packages. It is used in an AgentTeams deployment when SLS access is explicitly configured. The deterministic local Demo does not call a cloud account: its observability path remains the fixture-backed MCP adapter. Missing CLI configuration or read permission must stop the cloud path; it must not try another account or inspect credentials.

The upstream README currently has an Apache-2.0 license heading and also references MIT in its legal section. Both declarations and the upstream legal terms are disclosed rather than selecting one silently:

- Repository: <https://github.com/aliyun/alibabacloud-aiops-skills>
- Portal detail API: <https://skills.aliyun.com/api/public/skills/alibabacloud-sls-query>
- Portal download API: <https://skills.aliyun.com/api/public/skills/alibabacloud-sls-query/download>
- Legal terms: <https://terms.alicdn.com/legal-agreement/terms/b_platform_service_agreement/20260330114515787/20260330114515787.html>
