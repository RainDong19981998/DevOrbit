const $ = selector => document.querySelector(selector);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const demoParams = new URLSearchParams(window.location.search);
const demoMode = demoParams.get('demo');
const demoDelay = Math.max(3000, Math.min(15000, Number(demoParams.get('delay')) || 6000));
let currentRunId = null;
let renderedTraceCount = 0;
const stageIndex = { triage: 0, impact: 1, rca: 2, patch: 3, verify: 4, release: 5, learn: 6 };

function showSignals(signals) {
  $('#signals').innerHTML = signals.map(s => `<div class="signal-row"><b>${s.source}</b><time>${s.time}</time><span>${s.text}</span></div>`).join('');
}

function showTrace(item, index, total) {
  if (index === 0) $('#trace').innerHTML = '';
  $('#trace').insertAdjacentHTML('beforeend', `<div class="trace-row"><span class="node"></span><div><b>${item.agent}<code>${item.skill}</code></b><p>${item.message}</p></div></div>`);
  $('#trace').scrollTop = $('#trace').scrollHeight;
  $('#trace-count').textContent = `${index + 1} / ${total}`;
}

async function animateTrace(data, from = 0) {
  if (from === 0) $('#trace').innerHTML = '';
  for (let i = from; i < data.trace.length; i++) {
    const item = data.trace[i];
    const stage = stageIndex[item.stage] ?? 0;
    document.querySelectorAll('.pipeline article').forEach((x, j) => x.classList.toggle('active', j <= stage));
    showTrace(item, i, data.trace.length);
    if (item.stage === 'rca' && item.agent !== 'devorbit-lead') showFinding(data);
    if (item.stage === 'verify' && item.agent !== 'devorbit-lead') showRelease(data);
    await sleep(260);
  }
  renderedTraceCount = data.trace.length;
}

function showFinding(data) {
  if (!data.causes?.length) {
    $('#confidence').textContent = '--';
    $('#finding').innerHTML = '<p class="empty">该场景未进入根因分析</p>';
    return;
  }
  $('#confidence').textContent = `置信度 ${Math.round(data.causes[0].score * 100)}%`;
  const stop = data.rca?.decision === 'needs_human' ? `<div class="safety-stop">置信度低于 0.80，自动修复已停止。待补证：${data.rca.missingEvidence.join('、')}</div>` : '';
  $('#finding').innerHTML = `<div class="cause"><b>首要根因</b><p>${data.causes[0].statement}</p><div class="chips">${data.causes[0].evidence.map(x => `<span>${x}</span>`).join('')}</div></div>${stop}<p class="impact-line"><b>影响服务：</b>${data.impact.services.join(' → ')}<br><b>影响接口：</b>${data.impact.endpoints.join('、')}<br><b>影响用户：</b>${data.impact.users}<br><b>代码位置：</b>${data.impact.files.join('、')}</p>`;
}

function showRelease(data) {
  if (!data.plan) {
    $('#release').innerHTML = '<div class="safety-stop">根因证据门禁未通过。Patch Worker、CI 和发布工具均未调用。</div>';
    return;
  }
  if (data.tests?.gate === 'failed') {
    $('#release').innerHTML = `<div class="patch">${data.plan.patch}</div><div class="approval-box rejected"><small>真实测试门禁</small><b>${data.tests.passed} passed · <span class="test-failed">${data.tests.failed} failed</span></b><div class="impact-line">制品 ${data.tests.artifact}<br>发布工具未调用，状态转为 needs_human。</div></div>`;
    return;
  }
  const pending = data.approval.state === 'pending';
  const rejected = data.approval.state === 'rejected';
  const rolledBack = data.release?.decision === 'rolled_back';
  const decision = pending
    ? `<div class="approval-box"><small>L2 人工门禁</small><b>测试已通过，等待发布负责人决策</b><div><button class="approve" id="approve-button">✓ 批准 10% 灰度</button><button class="reject" id="reject-button">× 拒绝</button></div></div>`
    : rejected
      ? `<div class="approval-box rejected"><small>发布决策</small><b>已拒绝，发布工具未被调用</b></div>`
      : `<div class="gate"><div class="good"><small>Red → Green</small><b>${data.plan.baselineTests.failed} failed → ${data.tests.passed} passed</b></div><div><small>审批记录</small><b>${data.approval.approvalId}</b></div><div class="${rolledBack ? '' : 'good'}"><small>灰度前 → 灰度后</small><b>${data.release.healthBefore.errorRate}% → ${data.release.healthAfter.errorRate}%</b></div><div class="${rolledBack ? '' : 'good'}"><small>最终决策</small><b>${rolledBack ? '↶ 阈值越界 · 已自动回滚' : '✓ 确认放量 · 可回滚'}</b></div></div>`;
  $('#release').innerHTML = `<div class="patch">${data.plan.patch}</div>${decision}`;
  if (pending) {
    $('#approve-button').addEventListener('click', () => resolveApproval('approved'));
    $('#reject-button').addEventListener('click', () => resolveApproval('rejected'));
  }
}

function showSkills(skills) {
  $('#skill-grid').innerHTML = skills.map((s, i) => `<article class="skill-card"><code>${s.official ? 'OFFICIAL CLOUD' : 'CUSTOM'} / 0${i + 1}</code><h3>${s.name}</h3><p>${s.purpose}</p><footer><span>${s.risk}</span><span>v${s.version || '1.0.0'}</span></footer></article>`).join('');
}

async function run() {
  const button = $('#run-button');
  button.disabled = true; button.innerHTML = '<span>◌</span> Agent 协同执行中';
  $('#run-state').className = 'run-state running'; $('#run-state').innerHTML = '<span></span>运行中 · RUN-0812-014';
  document.querySelectorAll('.pipeline article').forEach(x => x.classList.remove('active'));
  renderedTraceCount = 0;
  const scenario = $('#scenario-select').value;
  const response = await fetch('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario }) });
  const data = await response.json();
  currentRunId = data.state.caseId;
  showSignals(data.incident.signals);
  await animateTrace(data);
  showFinding(data); showRelease(data);
  $('#metric-mcp').textContent = data.metrics.mcpCalls;
  $('#metric-otel').textContent = data.observability?.summary?.spans || '--';
  if (data.state.status === 'approval_pending') {
    $('#run-state').className = 'run-state waiting'; $('#run-state').innerHTML = '<span></span>等待 L2 人工审批';
    if (demoMode === 'happy-path' || demoMode === 'canary-regression') {
      $('#release').closest('.panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => resolveApproval('approved'), 2400);
    }
  } else if (data.state.status === 'needs_human') {
    $('#run-state').className = 'run-state rejected'; $('#run-state').innerHTML = '<span></span>安全停止 · needs_human';
    button.disabled = false; button.innerHTML = '<span>↻</span> 重新运行案例';
  }
}

async function resolveApproval(state) {
  const response = await fetch(`/api/runs/${encodeURIComponent(currentRunId)}/approval`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: state }) });
  const data = await response.json();
  const button = $('#run-button');
  showRelease(data);
  await animateTrace(data, renderedTraceCount);
  if (state === 'rejected') {
    $('#run-state').className = 'run-state rejected'; $('#run-state').innerHTML = '<span></span>已拒绝 · 未执行发布';
    button.disabled = false; button.innerHTML = '<span>↻</span> 重新运行案例';
    return;
  }
  $('#metric-mcp').textContent = data.metrics.mcpCalls;
  $('#metric-otel').textContent = data.observability?.summary?.spans || '--';
  $('#run-state').className = data.release.decision === 'rolled_back' ? 'run-state rejected' : 'run-state done';
  $('#run-state').innerHTML = data.release.decision === 'rolled_back' ? '<span></span>闭环完成 · 灰度已回滚并沉淀' : '<span></span>闭环完成 · 知识卡 ' + data.knowledge.cardId;
  button.disabled = false; button.innerHTML = '<span>↻</span> 重新运行案例';
  if (demoMode) {
    $('#release').closest('.panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => document.querySelector('#skills').scrollIntoView({ behavior: 'smooth' }), 2200);
    setTimeout(() => document.querySelector('#evidence').scrollIntoView({ behavior: 'smooth' }), 5000);
  }
}

const initial = await fetch('/api/meta').then(r => r.json());
showSkills(initial.skills);
fetch('/reports/evaluation.json').then(r => r.json()).then(report => {
  $('#metric-eval').textContent = `${report.summary.passed}/${report.summary.cases}`;
}).catch(() => {});
fetch('/reports/security-evaluation.json').then(r => r.json()).then(report => {
  $('#metric-security').textContent = `${report.summary.passed}/${report.summary.cases}`;
}).catch(() => {});
$('#run-button').addEventListener('click', run);

if (['happy-path', 'low-confidence', 'test-failure', 'canary-regression'].includes(demoMode)) {
  $('#scenario-select').value = demoMode;
  setTimeout(() => document.querySelector('#workspace').scrollIntoView({ behavior: 'smooth' }), demoDelay - 1000);
  setTimeout(() => run(), demoDelay);
}
