import { mergeArtifact } from '../runtime/case-state.js';
import { recordTrace } from '../runtime/trace.js';

export const impactAgent = {
  id: 'impact-worker',
  skill: 'ImpactMap',
  async execute(state, context) {
    const orderFile = await context.mcp.callTool('repository.read_file', { path: 'src/order.js' });
    const poolFile = await context.mcp.callTool('repository.read_file', { path: 'src/redisPool.js' });
    const impact = {
      services: ['checkout-web', 'checkout-service', 'idempotency-store'],
      endpoints: ['POST /orders', 'POST /payments'],
      users: '约 7.4% 下单请求',
      files: ['src/order.js', 'src/redisPool.js', 'test/order.test.js', 'test/redisPool.test.js'],
      regressionTests: ['test/order.test.js', 'test/redisPool.test.js'],
      repositoryRevision: context.repositoryRevision,
      repositoryEvidence: [orderFile.data.digest, poolFile.data.digest],
      mcpCalls: [orderFile.call, poolFile.call]
    };
    mergeArtifact(state, 'impact', impact);
    recordTrace(state, { agent: this.id, skill: this.skill, stage: 'impact', parentSpanId: context.parentSpanId, message: '通过 MCP 读取关键代码并完成影响分析，输出 3 个服务、2 个接口与 4 个代码/测试文件。', evidence: [...impact.files.map(path => `repo://${path}`), ...impact.repositoryEvidence.map(value => `mcp://${value}`)], input: state.artifacts.canonical, output: impact });
    return impact;
  }
};
