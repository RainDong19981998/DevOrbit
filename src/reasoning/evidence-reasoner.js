function signalRefs(signals, matcher) {
  return signals.filter(signal => matcher.test(`${signal.id || ''} ${signal.text || ''}`)).map(signal => signal.id).filter(Boolean);
}

export function diagnoseFromEvidence({ signals = [], files = [], scenario = 'happy-path', historyCitation = null }) {
  const code = files.map(file => file.content || '').join('\n');
  const evidence = files.map(file => `repo://${file.path}`);
  let statement = '当前证据指向代码路径与现场症状不一致，需要补充可复现测试与变更记录。';
  let runnerUp = '外部依赖或容量变化可能放大症状，但尚无足够代码证据。';

  if (/poolSize:\s*[0-9]+/.test(code) && /createOrder/.test(code) && !/if\s*\(existing\)/.test(code)) {
    statement = '连接池容量与排队超时配置过低，同时订单创建路径未检查已存在的幂等键，超时重试会放大延迟并重复创建订单。';
    runnerUp = '网关 502 更像下游存储排队超时的结果，而不是首因。';
    evidence.push(...signalRefs(signals, /pool|timeout|幂等|重复|p95|变更|502/i));
  } else if (/deductStock/.test(code) && /current\s*-\s*quantity/.test(code) && !/current\s*<\s*quantity/.test(code)) {
    statement = '库存扣减路径在写入 current - quantity 前缺少余量校验，失败断言证明请求可将库存写成负数。';
    runnerUp = '流量突增会提高触发频率，但不能解释代码允许负库存这一机制缺陷。';
    evidence.push(...signalRefs(signals, /库存|超卖|negative|oversell|扣减|并发|变更/i));
  }

  const score = scenario === 'low-confidence' ? 0.62 : 0.91;
  return {
    driver: 'local-evidence-reasoner',
    deterministicFallback: true,
    causes: [
      { rank: 1, statement, score, evidence: [...new Set([...evidence, historyCitation].filter(Boolean))] },
      { rank: 2, statement: runnerUp, score: 0.46, evidence: [...new Set(signalRefs(signals, /502|流量|网关|容量|超时/i))] }
    ]
  };
}

function replaceNumber(source, key, minimum) {
  return source.replace(new RegExp(`(${key}\\s*:\\s*)(\\d+)`), (_, prefix, value) => `${prefix}${Math.max(Number(value), minimum)}`);
}

export function proposeEditsFromEvidence({ files = [], scenario = 'happy-path', attempt = 1 }) {
  const edits = [];
  const summaries = [];
  for (const file of files) {
    let content = file.content;
    if (/poolSize:\s*\d+/.test(content)) {
      const minimum = (scenario === 'self-healing' || scenario === 'circuit-breaker') && attempt === 1 ? 40 : 80;
      content = replaceNumber(content, 'poolSize', minimum);
      content = replaceNumber(content, 'queueTimeoutMs', 800);
      summaries.push(`将连接池容量恢复到 ${minimum}，排队超时下限设为 800ms`);
    }
    const skipBusinessGuard = scenario === 'test-failure' || scenario === 'circuit-breaker';
    if (!skipBusinessGuard && /function createOrder\s*\(\{ idempotencyKey, payload \}\)/.test(content) && !/const existing = ordersByKey\.get/.test(content)) {
      content = content.replace(
        /(export function createOrder\(\{ idempotencyKey, payload \}\) \{\n)/,
        '$1  const existing = ordersByKey.get(idempotencyKey);\n  if (existing) return { status: 409, order: existing };\n'
      );
      summaries.push('在创建订单前复用幂等键对应的原订单');
    }
    if (!skipBusinessGuard && /function deductStock/.test(content) && !/current\s*<\s*quantity/.test(content)) {
      content = content.replace(
        /(  const current = stockBySku\.get\(sku\) \?\? 0;\n)/,
        "$1  if (current < quantity) return { status: 409, remaining: current, reason: 'insufficient-stock' };\n"
      );
      summaries.push('在库存写入前增加非负余量门禁并以 409 拒绝不足请求');
    }
    if (content !== file.content) edits.push({ path: file.path, before: file.content, content });
  }
  return {
    driver: 'local-evidence-reasoner',
    deterministicFallback: true,
    edits,
    summary: summaries.join('；') || '没有从当前源码与失败反馈中推导出可验证的最小编辑'
  };
}
