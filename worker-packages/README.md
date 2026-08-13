# Worker package source

Each subdirectory follows the AgentTeams v1.2.2 package contract. Run `bash scripts/package_workers.sh` to produce ZIP files in `worker-packages/dist/`.

Local ZIPs cannot be uploaded by `agt apply -f`. Use the supported two-phase deployer:

```bash
MCP_URL=https://gateway.example.com/devorbit/mcp npm run deploy-agentteams
```

It calls `agt apply worker --zip` for each packaged Worker, renders the full MCP endpoint into an overlay manifest, applies all Worker fields, and creates the Team last. The seven custom Skills live inside their Worker ZIPs. The official `alibabacloud-sls-query` v0.0.2 snapshot is also bundled into Intake and RCA for explicitly configured, read-only cloud log retrieval; the default local Demo continues through the fixture-backed observability MCP adapter. Package Skills are intentionally not duplicated in `Worker.spec.skills`, which is AgentTeams' Manager-controlled on-demand Skill path.
