import { mergeArtifact } from '../runtime/case-state.js';
import { recordTrace } from '../runtime/trace.js';

export const impactAgent = {
  id: 'impact-worker',
  skill: 'ImpactMap',
  async execute(state, context) {
    const profile = context.profile;
    const sourceFiles = [];
    for (const path of profile.sourceFiles) {
      sourceFiles.push(await context.mcp.callTool('repository.read_file', { path }));
    }
    const impact = {
      services: profile.services,
      endpoints: profile.endpoints,
      users: profile.usersImpact,
      files: profile.files,
      regressionTests: profile.regressionTests,
      repositoryRevision: context.repositoryRevision,
      repositoryEvidence: sourceFiles.map(file => file.data.digest),
      mcpCalls: sourceFiles.map(file => file.call)
    };
    mergeArtifact(state, 'impact', impact);
    recordTrace(state, { agent: this.id, skill: this.skill, stage: 'impact', parentSpanId: context.parentSpanId, message: `通过 MCP 读取关键代码并完成影响分析，输出 ${profile.services.length} 个服务、${profile.endpoints.length} 个接口与 ${profile.files.length} 个代码/测试文件。`, evidence: [...impact.files.map(path => `repo://${path}`), ...impact.repositoryEvidence.map(value => `mcp://${value}`)], input: state.artifacts.canonical, output: impact });
    return impact;
  }
};
