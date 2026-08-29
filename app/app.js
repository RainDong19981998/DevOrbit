const $ = selector => document.querySelector(selector);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const html = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const demoParams = new URLSearchParams(window.location.search);
const demoMode = demoParams.get('demo');
const demoDelay = Math.max(3000, Math.min(15000, Number(demoParams.get('delay')) || 6000));
let currentRunId = null;
let renderedTraceCount = 0;
let currentData = null;
let activeEvidenceTab = 'patch';
const stageIndex = { triage: 0, impact: 1, rca: 2, patch: 3, verify: 4, release: 5, learn: 6 };

function showSignals(signals) {
  $('#signals').innerHTML = signals.map(s => `<div class="signal-row"><b>${html(s.source)}</b><time>${html(s.time)}</time><span>${html(s.text)}</span></div>`).join('');
}

function showTrace(item, index, total) {
  if (index === 0) $('#trace').innerHTML = '';
  const versionTag = item.skillVersion ? `<em class="skill-version">v${html(item.skillVersion)}</em>` : '';
  const digestTag = item.skillDigest ? `<small class="skill-digest">${html(item.skillDigest.slice(0, 19))}…</small>` : '';
  $('#trace').insertAdjacentHTML('beforeend', `<div class="trace-row"><span class="node"></span><div><b>${html(item.agent)}<code>${html(item.skill)}</code>${versionTag}${digestTag}</b><p>${html(item.message)}</p></div></div>`);
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
  const stop = data.rca?.decision === 'needs_human' ? `<div class="safety-stop">置信度低于 0.80，自动修复已停止。待补证：${data.rca.missingEvidence.map(html).join('、')}</div>` : '';
  const resampling = data.rca?.resampling;
  const trajectory = (resampling?.trace?.length && resampling.trace.length > 0) ? `<div class="confidence-trajectory"><p class="artifact-kicker">置信度轨迹</p><div class="trajectory-line">${resampling.trace.map(t => `<div class="trajectory-node"><b class="before">${t.confidenceBefore?.toFixed(2) ?? '--'}</b><span class="arrow">→</span></div>`).join('')}<div class="trajectory-node final"><b class="after">${resampling.finalConfidence?.toFixed(2) ?? '--'}</b><span>补证 ${resampling.rounds} 轮后</span></div></div></div>` : '';
  $('#finding').innerHTML = `<div class="cause"><b>首要根因</b><p>${html(data.causes[0].statement)}</p><div class="chips">${data.causes[0].evidence.map(x => `<span>${html(x)}</span>`).join('')}</div></div>${trajectory}${stop}<p class="impact-line"><b>影响服务：</b>${data.impact.services.map(html).join(' → ')}<br><b>影响接口：</b>${data.impact.endpoints.map(html).join('、')}<br><b>影响用户：</b>${html(data.impact.users)}<br><b>代码位置：</b>${data.impact.files.map(html).join('、')}</p>`;
}

function showRelease(data) {
  const reworkBadge = $('#rework-badge');
  if (reworkBadge) {
    const attempts = data.plan?.attempts;
    if (attempts && attempts > 1) {
      reworkBadge.innerHTML = `返工 ${attempts}/${data.plan?.maxAttempts ?? 3}`;
      reworkBadge.style.display = 'inline-block';
    } else {
      reworkBadge.innerHTML = '';
      reworkBadge.style.display = 'none';
    }
  }
  if (!data.plan) {
    $('#release').innerHTML = '<div class="safety-stop">根因证据门禁未通过。Patch Worker、CI 和发布工具均未调用。</div>';
    return;
  }
  if (data.tests?.gate === 'failed') {
    $('#release').innerHTML = `<div class="patch">${html(data.plan.patch)}</div><div class="approval-box rejected"><small>真实测试门禁</small><b>${html(data.tests.passed)} passed · <span class="test-failed">${html(data.tests.failed)} failed</span></b><div class="impact-line">制品 ${html(data.tests.artifact)}<br>发布工具未调用，状态转为 needs_human。</div></div>`;
    return;
  }
  const pending = data.approval.state === 'pending';
  const rejected = data.approval.state === 'rejected';
  const rolledBack = data.release?.decision === 'rolled_back';
  const decision = pending
    ? `<div class="approval-box"><small>L2 人工门禁</small><b>测试已通过，等待发布负责人决策</b><div><button class="approve" id="approve-button">✓ 批准 10% 灰度</button><button class="reject" id="reject-button">× 拒绝</button></div></div>`
    : rejected
      ? `<div class="approval-box rejected"><small>发布决策</small><b>已拒绝，发布工具未被调用</b></div>`
      : `<div class="gate"><div class="good"><small>Red → Green</small><b>${html(data.plan.baselineTests.failed)} failed → ${html(data.tests.passed)} passed</b></div><div><small>审批记录</small><b>${html(data.approval.approvalId)}</b></div><div class="${rolledBack ? '' : 'good'}"><small>灰度观测</small><b>${Number.isFinite(data.release.healthBefore?.errorRate) ? `${html(data.release.healthBefore.errorRate)}% → ${html(data.release.healthAfter.errorRate)}%` : html(data.release.observationWindow)}</b></div><div class="${rolledBack ? '' : 'good'}"><small>最终决策</small><b>${rolledBack ? '↶ 阈值越界 · 已自动回滚' : '✓ 确认放量 · 可回滚'}</b></div></div>`;
  $('#release').innerHTML = `<div class="patch">${html(data.plan.patch)}</div>${decision}`;
  if (pending) {
    $('#approve-button').addEventListener('click', () => resolveApproval('approved'));
    $('#reject-button').addEventListener('click', () => resolveApproval('rejected'));
  }
}

function showSkills(skills) {
  $('#skill-grid').innerHTML = skills.map((s, i) => `<article class="skill-card"><code>${s.official ? 'OFFICIAL CLOUD' : 'CUSTOM'} / 0${i + 1}</code><h3>${html(s.name)}</h3><p>${html(s.purpose)}</p><footer><span>${html(s.risk)}</span><span>v${html(s.version || '1.0.0')}</span></footer></article>`).join('');
}

function evidenceRows(items) {
  if (!items?.length) return '<p class="empty compact">该阶段没有可用证据</p>';
  return `<div class="evidence-table">${items.join('')}</div>`;
}

function showArtifacts(data, tab = activeEvidenceTab) {
  currentData = data;
  activeEvidenceTab = tab;
  document.querySelectorAll('.artifact-tab').forEach(button => button.classList.toggle('active', button.dataset.evidenceTab === tab));
  const target = $('#artifact-view');
  if (tab === 'patch') {
    if (!data.plan) {
      target.innerHTML = '<div class="safety-stop">未生成补丁。根因证据门禁已阻止 Patch Worker 继续执行。</div>';
      return;
    }
    target.innerHTML = `<div class="artifact-grid"><div><span class="artifact-kicker">MINIMAL PATCH</span><h4>${html(data.plan.summary)}</h4><pre>${html(data.plan.patch)}</pre></div><dl><div><dt>修改文件</dt><dd>${data.plan.files.map(html).join('<br>')}</dd></div><div><dt>补丁摘要</dt><dd>${html(data.plan.patchDigest)}</dd></div><div><dt>回滚点</dt><dd>${html(data.plan.rollbackRef)}</dd></div><div><dt>风险级别</dt><dd>${html(data.plan.risk)}</dd></div></dl></div>`;
    return;
  }
  if (tab === 'tests') {
    const baseline = data.plan?.baselineTests;
    const patched = data.tests;
    target.innerHTML = `<div class="test-compare"><article class="test-result failed"><span>BEFORE PATCH</span><b>${html(baseline?.passed ?? 0)} passed · ${html(baseline?.failed ?? 0)} failed</b><small>${html(baseline?.artifact || 'not-run')}</small><pre>${html(baseline?.outputTail || '补丁前测试未运行')}</pre></article><article class="test-result ${patched?.gate === 'passed' ? 'passed' : 'failed'}"><span>AFTER PATCH</span><b>${html(patched?.passed ?? 0)} passed · ${html(patched?.failed ?? 0)} failed</b><small>${html(patched?.artifact || 'not-run')}</small><pre>${html(patched?.outputTail || '补丁后测试未运行')}</pre></article></div>`;
    return;
  }
  if (tab === 'mcp') {
    target.innerHTML = evidenceRows((data.mcp?.audit || []).map(item => `<div class="evidence-row"><code>${html(item.tool)}</code><b>${html(item.caller)}</b><span class="risk ${html(item.risk).toLowerCase()}">${html(item.risk)}</span><span>${html(item.policyDecision)} · ${html(item.status)}</span><small>${html(item.auditRef)}</small></div>`));
    return;
  }
  if (tab === 'trace') {
    target.innerHTML = evidenceRows((data.trace || []).map(item => `<div class="evidence-row trace-evidence"><code>${html(item.stage)}</code><b>${html(item.agent)}</b><span>${html(item.skill)}${item.skillVersion ? ` v${html(item.skillVersion)}` : ''}</span><span>${html(item.status)}</span><small>${html(item.spanId)} · ${html(item.skillDigest ? item.skillDigest.slice(0, 16) + '…' : `${item.evidence?.length || 0} refs`)}</small></div>`));
    return;
  }
  if (tab === 'knowledge') {
    const knowledge = data.knowledge;
    target.innerHTML = knowledge ? `<div class="knowledge-evidence"><span class="artifact-kicker">${html(knowledge.citation)}</span><h4>${html(knowledge.pattern)}</h4><p>结果：${html(knowledge.outcome)}</p><ul>${knowledge.prevention.map(item => `<li>${html(item)}</li>`).join('')}</ul><div class="chips">${knowledge.tags.map(item => `<span>${html(item)}</span>`).join('')}</div></div>` : '<p class="empty compact">尚未达到知识沉淀终态</p>';
    return;
  }
  if (tab === 'warnings') {
    showWarnings(data);
    return;
  }
}

function showWarnings(data) {
  const target = $('#artifact-view');
  const warnings = data.rca?.warnings || [];
  if (warnings.length === 0) {
    target.innerHTML = '<p class="empty compact">本次运行未检索到负面方案警示</p>';
    return;
  }
  target.innerHTML = warnings.map(w => `<div class="warning-card"><div class="warning-header"><span class="warning-id">${html(w.id || w.episodeId || '--')}</span><span class="badge ${w.recallStatus === 'negative' ? 'badge-red' : 'badge-gray'}">${html(w.recallStatus || '--')}</span></div><p class="warning-message">${html(w.warningMessage || w.title || '--')}</p></div>`).join('');
}

async function run() {
  const button = $('#run-button');
  button.disabled = true; button.innerHTML = '<span>◌</span> Agent 协同执行中';
  $('#run-state').className = 'run-state running'; $('#run-state').innerHTML = '<span></span>运行中 · RUN-0812-014';
  document.querySelectorAll('.pipeline article').forEach(x => x.classList.remove('active'));
  renderedTraceCount = 0;
  const scenario = $('#scenario-select').value;
  const response = await fetch('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    scenario,
    title: $('#incident-title').value.trim(),
    repository: $('#incident-repository').value.trim(),
    branch: $('#incident-branch').value.trim()
  }) });
  const data = await response.json();
  currentRunId = data.state.caseId;
  showSignals(data.incident.signals);
  await animateTrace(data);
  showFinding(data); showRelease(data); showArtifacts(data); showEvidenceChain(data);
  $('#metric-mcp').textContent = data.metrics.mcpCalls;
  $('#metric-otel').textContent = data.observability?.summary?.spans || '--';
  if (data.state.status === 'approval_pending') {
    $('#run-state').className = 'run-state waiting'; $('#run-state').innerHTML = '<span></span>等待 L2 人工审批';
    if (['happy-path', 'canary-regression', 'dynamic-resampling', 'self-healing', 'tour'].includes(demoMode)) {
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
  showRelease(data); showArtifacts(data); showEvidenceChain(data);
  await animateTrace(data, renderedTraceCount);
  if (state === 'rejected') {
    $('#run-state').className = 'run-state rejected'; $('#run-state').innerHTML = '<span></span>已拒绝 · 未执行发布';
    button.disabled = false; button.innerHTML = '<span>↻</span> 重新运行案例';
    return;
  }
  $('#metric-mcp').textContent = data.metrics.mcpCalls;
  $('#metric-otel').textContent = data.observability?.summary?.spans || '--';
  $('#run-state').className = data.release.decision === 'rolled_back' ? 'run-state rejected' : 'run-state done';
  $('#run-state').innerHTML = data.release.decision === 'rolled_back' ? '<span></span>闭环完成 · 灰度已回滚并沉淀' : '<span></span>闭环完成 · 知识卡 ' + html(data.knowledge.cardId || data.knowledge.episodeId);
  button.disabled = false; button.innerHTML = '<span>↻</span> 重新运行案例';
  if (demoMode && demoMode !== 'tour') {
    $('#release').closest('.panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      showArtifacts(data, 'tests');
      document.querySelector('#artifacts').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 1800);
    setTimeout(() => showArtifacts(data, 'mcp'), 4600);
    setTimeout(() => document.querySelector('#skills').scrollIntoView({ behavior: 'smooth' }), 7600);
    setTimeout(() => document.querySelector('#evidence').scrollIntoView({ behavior: 'smooth' }), 10500);
  }
}

let tamperedChain = null;

function showEvidenceChain(data) {
  const chain = data.evidenceChain;
  const container = $('#evidence-chain');
  const status = $('#chain-status');
  const tamperBtn = $('#tamper-button');
  const reverifyBtn = $('#reverify-button');
  if (!chain || !chain.links || chain.links.length === 0) {
    container.innerHTML = '<p class="empty">运行案例后生成证据链</p>';
    status.textContent = '等待运行'; status.className = 'chain-status idle';
    tamperBtn.disabled = true; reverifyBtn.disabled = true;
    return;
  }
  tamperedChain = null;
  renderChain(chain, true);
  status.textContent = `已验证 · ${chain.linkCount} 环节`; status.className = 'chain-status verified';
  tamperBtn.disabled = false; reverifyBtn.disabled = true;
}

function renderChain(chain, verified) {
  const container = $('#evidence-chain');
  const nodes = chain.links.map((link, i) => {
    const cls = verified ? 'chain-node ok' : (link._broken ? 'chain-node broken' : 'chain-node ok');
    return `<div class="${cls}"><b>${html(link.stage)}</b><code>${html(link.linkHash?.slice(0, 8) || '????????')}</code></div>${i < chain.links.length - 1 ? '<span class="chain-link"></span>' : ''}`;
  }).join('');
  container.innerHTML = `<div class="chain-nodes">${nodes}</div>`;
}

function tamperChain() {
  if (!currentData?.evidenceChain) return;
  const chain = JSON.parse(JSON.stringify(currentData.evidenceChain));
  if (chain.links.length < 2) return;
  const tamperedIndex = 1;
  chain.links[tamperedIndex].stageHash = 'deadbeefdeadbeef';
  chain.links[tamperedIndex]._broken = true;
  tamperedChain = chain;
  renderChain(chain, false);
  const status = $('#chain-status');
  status.textContent = '已篡改 · 等待验证'; status.className = 'chain-status tampered';
  $('#reverify-button').disabled = false;
  $('#chain-note').textContent = `已篡改第 ${tamperedIndex + 1} 环节（${chain.links[tamperedIndex].stage}）的 stageHash`;
}

function reverifyChain() {
  const chain = tamperedChain || currentData?.evidenceChain;
  if (!chain || !currentData?.evidenceChain) return;
  const original = currentData.evidenceChain.links;
  let brokenAt = -1;
  for (let i = 0; i < chain.links.length; i++) {
    if (chain.links[i].stageHash !== original[i].stageHash) {
      brokenAt = i;
      chain.links[i]._broken = true;
      break;
    }
  }
  renderChain(chain, false);
  const status = $('#chain-status');
  if (brokenAt >= 0) {
    status.textContent = `验证失败 · 第 ${brokenAt + 1} 环节断链`; status.className = 'chain-status broken';
    $('#chain-note').textContent = `链式 sha256 检出：第 ${brokenAt + 1} 环节（${chain.links[brokenAt].stage}）的 stageHash 与原始值不匹配`;
  } else {
    status.textContent = `已验证 · ${chain.linkCount} 环节`; status.className = 'chain-status verified';
    $('#chain-note').textContent = '';
  }
}

const initial = await fetch('/api/meta').then(r => r.json());
showSkills(initial.skills);
fetch('/api/case').then(r => r.json()).then(incident => {
  $('#incident-title').value = incident.title;
  $('#incident-repository').value = incident.repository;
  $('#incident-branch').value = incident.branch;
}).catch(() => {});
fetch('/reports/evaluation.json').then(r => r.json()).then(report => {
  $('#metric-eval').textContent = `${report.summary.passed}/${report.summary.cases}`;
}).catch(() => {});
fetch('/reports/security-evaluation.json').then(r => r.json()).then(report => {
  $('#metric-security').textContent = `${report.summary.passed}/${report.summary.cases}`;
}).catch(() => {});
renderBenchmarkBoard();
async function renderBenchmarkBoard() {
  const board = $('#benchmark-board');
  if (!board) return;
  try {
    const [ablation, benchmark] = await Promise.all([
      fetch('/reports/model-ablation.json').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/reports/public-benchmark.json').then(r => r.ok ? r.json() : null).catch(() => null)
    ]);
    if (!ablation && !benchmark) return;
    const pct = m => m == null ? 'n/a' : `${(m.mean * 100).toFixed(1)}%`;
    const rows = [];
    if (ablation) {
      for (const entry of ablation.entries || []) {
        if (entry.status !== 'completed') { rows.push({ label: entry.label, status: entry.status, closed: null, apply: null, note: entry.note }); continue; }
        for (const [method, s] of Object.entries(entry.methods || {})) {
          if (!s) continue;
          rows.push({ label: `${entry.label} · ${method}`, status: 'completed', closed: s.closedLoopRate, apply: s.patchApplyRate, test: s.testPassRate, n: s.runs });
        }
      }
    }
    const maxClosed = Math.max(0.0001, ...rows.filter(r => r.closed).map(r => r.closed.mean));
    const html = ['<div class="bench-table"><div class="bench-row bench-head"><span>配置（同一冻结 30 案例）</span><span>闭环率</span><span>补丁可应用率</span><span>测试通过率</span></div>'];
    for (const row of rows) {
      if (row.status !== 'completed') {
        html.push(`<div class="bench-row bench-na"><span>${row.label}</span><span colspan="3">${row.status === 'not_run' ? '未运行' : row.status}</span></div>`);
        continue;
      }
      const w = row.closed ? Math.max(2, (row.closed.mean / maxClosed) * 100) : 0;
      html.push(`<div class="bench-row"><span class="bench-label">${row.label}</span><span class="bench-bar-cell"><i class="bench-bar" style="width:${w}%"></i><b>${pct(row.closed)}</b></span><span>${pct(row.apply)}</span><span>${pct(row.test)}</span></div>`);
    }
    html.push('</div>');
    html.push('<p class="bench-note">区间与失败样本详见 reports/model-ablation.md 与 reports/public-benchmark.md；edit-based 为 V0.9.6 补丁引擎重构，diff-based 为 V0.8 归档基线。</p>');
    board.innerHTML = html.join('');
  } catch { /* 无基准数据时保持占位 */ }
}
$('#run-button').addEventListener('click', run);
document.querySelectorAll('.artifact-tab').forEach(button => button.addEventListener('click', () => {
  if (currentData) showArtifacts(currentData, button.dataset.evidenceTab);
}));
$('#tamper-button').addEventListener('click', tamperChain);
$('#reverify-button').addEventListener('click', reverifyChain);

if (['happy-path', 'low-confidence', 'test-failure', 'canary-regression', 'dynamic-resampling', 'self-healing'].includes(demoMode)) {
  $('#scenario-select').value = demoMode;
  setTimeout(() => document.querySelector('#workspace').scrollIntoView({ behavior: 'smooth' }), demoDelay - 1000);
  setTimeout(() => run(), demoDelay);
}

if (demoMode === 'tour' && window.TOUR_TIMELINE) {
  const tourDelay = Number(demoParams.get('tourDelay')) || 3000;
  const startTour = timeline => {
    const captionBar = document.createElement('div');
    captionBar.className = 'tour-caption';
    document.body.appendChild(captionBar);
    const progressBar = document.createElement('div');
    progressBar.className = 'tour-progress';
    document.body.appendChild(progressBar);
    const startedAt = Date.now();
    setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      progressBar.style.width = `${Math.min(100, (elapsed / timeline.totalDuration) * 100)}%`;
    }, 200);
    for (const scene of timeline.scenes) {
      setTimeout(() => {
        captionBar.textContent = scene.caption;
        captionBar.classList.add('visible');
        if (scene.action === 'run') {
          $('#scenario-select').value = 'happy-path';
          document.querySelector('#workspace').scrollIntoView({ behavior: 'smooth' });
          setTimeout(() => run(), 800);
        } else if (scene.action.startsWith('run:')) {
          $('#scenario-select').value = scene.action.slice(4);
          document.querySelector('#workspace').scrollIntoView({ behavior: 'smooth' });
          setTimeout(() => run(), 800);
        } else if (scene.action === 'top') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (scene.action === 'hold') {
          /* 停留在当前画面 */
        } else if (scene.action.startsWith('scroll:')) {
          const target = document.querySelector(scene.action.slice(7));
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, scene.at * 1000);
    }
  };
  if (document.readyState === 'complete') setTimeout(() => startTour(window.TOUR_TIMELINE), tourDelay);
  else window.addEventListener('load', () => setTimeout(() => startTour(window.TOUR_TIMELINE), tourDelay));
}
