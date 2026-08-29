function changedLines(diff) {
  return String(diff || '')
    .split('\n')
    .filter(line => (/^[+-]/.test(line) && !/^(---|\+\+\+)/.test(line)))
    .map(line => line.slice(1).trim())
    .filter(Boolean);
}

function isCommentOnly(line) {
  return /^(#|\/\/|\/\*|\*|\*\/)/.test(line);
}

export function isAllowedModelPilotPath(path, allowedWritePrefix = 'src/', forbiddenWritePrefixes = []) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\')) return false;
  const segments = path.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return false;
  return path.startsWith(allowedWritePrefix) && !forbiddenWritePrefixes.some(prefix => path.startsWith(prefix));
}

export function evaluateModelPilotGate({
  targetExitCode,
  regressionExitCode,
  classificationExitCode,
  changedPaths = [],
  diff = '',
  allowedWritePrefix = 'src/',
  forbiddenWritePrefixes = [],
  requireExecutableChange = true,
  policyChecks = {}
}) {
  const uniquePaths = [...new Set(changedPaths)];
  const lines = changedLines(diff);
  const checks = {
    targetPassed: targetExitCode === 0,
    regressionPassed: regressionExitCode === 0,
    classificationPassed: classificationExitCode === 0,
    diffPresent: String(diff).trim().length > 0,
    sourceOnly: uniquePaths.length > 0 && uniquePaths.every(path => isAllowedModelPilotPath(path, allowedWritePrefix, forbiddenWritePrefixes)),
    executableChange: !requireExecutableChange || lines.some(line => !isCommentOnly(line)),
    ...Object.fromEntries(Object.entries(policyChecks).map(([name, ok]) => [`policy:${name}`, ok === true]))
  };
  const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  return {
    authority: 'deterministic-machine-gate',
    passed: failedChecks.length === 0,
    checks,
    failedChecks
  };
}

export function enforceModelPilotVerdict(machineGate, modelVerdict) {
  const modelAccept = modelVerdict?.accept === true;
  return {
    accepted: machineGate.passed && modelAccept,
    machineGatePassed: machineGate.passed,
    modelAccept,
    rule: 'machineGatePassed && modelAccept'
  };
}
