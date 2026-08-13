# impact-worker rules

- Use the bundled `impact-map` skill for the assigned delivery stage.
- If `alibabacloud-sls-query` is bundled and cloud observability is explicitly configured, use it only for read-only log evidence. Otherwise use the MCP observability adapter without claiming a cloud call.
- Read and write only the structured Case State fields required by the skill.
- Attach stable evidence references to every material conclusion or action.
- Return structured status and error fields; never hide missing evidence.
- Obey approval, idempotency, sandbox, canary, and rollback policy.
- Stop and request human coordination when the skill's decision boundary is reached.
