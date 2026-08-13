export const adapters = [
  { id: 'issue-adapter', name: 'Issue Adapter', protocol: 'MCP 2025-06-18', tools: ['issue.fetch_signals'], reads: ['issue', 'feedback'], writes: [] },
  { id: 'observability-adapter', name: 'Observability Adapter', protocol: 'MCP 2025-06-18', tools: ['observability.fetch_signals'], reads: ['logs', 'metrics', 'changes'], writes: [] },
  { id: 'repo-adapter', name: 'Repository Adapter', protocol: 'MCP 2025-06-18', tools: ['repository.read_file', 'repository.create_workspace', 'repository.write_file', 'repository.dispose_workspace'], reads: ['files'], writes: ['workspace', 'patch'] },
  { id: 'ci-adapter', name: 'CI Adapter', protocol: 'MCP 2025-06-18', tools: ['ci.run_tests'], reads: ['test_jobs', 'artifacts'], writes: ['run_job'] },
  { id: 'release-adapter', name: 'Release Adapter', protocol: 'MCP 2025-06-18', tools: ['release.canary'], reads: ['rollout', 'health'], writes: ['promote', 'rollback'] },
  { id: 'knowledge-adapter', name: 'Knowledge Adapter', protocol: 'MCP 2025-06-18', tools: ['knowledge.search_cases', 'knowledge.write_case'], reads: ['cases'], writes: ['case_card'] }
];
