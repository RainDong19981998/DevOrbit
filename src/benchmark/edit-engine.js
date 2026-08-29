const normalizeLine = line => String(line ?? '').replace(/\s+$/, '').replace(/^\s+/, '');

function countOccurrences(text, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

function findFuzzyRegion(fileLines, searchLines) {
  const normFile = fileLines.map(normalizeLine);
  const normSearch = searchLines.map(normalizeLine);
  const k = normSearch.length;
  if (k === 0 || k > normFile.length) return null;
  for (let start = 0; start + k <= normFile.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < k; offset += 1) {
      if (normFile[start + offset] !== normSearch[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return { start, end: start + k };
  }
  return null;
}

export function applyEditToText(fileText, edit) {
  const search = typeof edit.search === 'string' ? edit.search : '';
  const replace = typeof edit.replace === 'string' ? edit.replace : '';

  if (search === '') {
    return { applied: true, text: replace, method: 'rewrite', ambiguous: false };
  }

  const exactIndex = fileText.indexOf(search);
  if (exactIndex !== -1) {
    const occurrences = countOccurrences(fileText, search);
    const text = fileText.slice(0, exactIndex) + replace + fileText.slice(exactIndex + search.length);
    return { applied: true, text, method: 'exact', ambiguous: occurrences > 1 };
  }

  const fileLines = fileText.split('\n');
  const searchLines = search.replace(/\n$/, '').split('\n');
  const region = findFuzzyRegion(fileLines, searchLines);
  if (!region) {
    return { applied: false, text: fileText, method: null, ambiguous: false, reason: 'search block not found (exact and whitespace-normalized match both failed)' };
  }
  const replaceLines = replace.split('\n');
  const nextLines = [...fileLines.slice(0, region.start), ...replaceLines, ...fileLines.slice(region.end)];
  return { applied: true, text: nextLines.join('\n'), method: 'fuzzy', ambiguous: false };
}

const TEST_PATH_PATTERN = /(^|\/)(tests?|testing)\//;

export function isBenchmarkPathAllowed(path) {
  if (typeof path !== 'string' || !path) return false;
  if (path.startsWith('/') || path.includes('..')) return false;
  if (TEST_PATH_PATTERN.test(path)) return false;
  if (path.endsWith('.patch') || path.endsWith('.diff')) return false;
  return true;
}

export function applyEditBatch({ sources, edits, maxChangedFiles = 3, isPathAllowed = isBenchmarkPathAllowed }) {
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) {
    return { applied: false, outputs: null, changedPaths: [], failures: [], safetyViolation: true, safetyReason: 'sources must be an object' };
  }
  if (!Array.isArray(edits) || edits.length < 1) {
    return { applied: false, outputs: null, changedPaths: [], failures: [{ reason: 'no edits provided' }], safetyViolation: false, safetyReason: null };
  }

  const failures = [];
  for (const [index, edit] of edits.entries()) {
    const path = edit?.path;
    if (!isPathAllowed(path)) {
      failures.push({ index, path: String(path), reason: 'path policy violation (test file, traversal, or non-source)' });
    }
  }
  const changedPaths = [...new Set(edits.map(edit => edit?.path).filter(Boolean))];
  if (changedPaths.length > maxChangedFiles) {
    failures.push({ reason: `changed file limit exceeded: ${changedPaths.length} > ${maxChangedFiles}` });
  }
  if (failures.length) {
    return { applied: false, outputs: null, changedPaths, failures, safetyViolation: true, safetyReason: failures[0].reason };
  }

  const staged = new Map(Object.entries(sources));
  const appliedMethods = [];
  for (const [index, edit] of edits.entries()) {
    const path = edit.path;
    if (!staged.has(path)) {
      failures.push({ index, path, reason: 'source not loaded (file missing from repository context)' });
      continue;
    }
    const result = applyEditToText(staged.get(path), edit);
    if (!result.applied) {
      failures.push({ index, path, reason: result.reason, searchPreview: String(edit.search || '').slice(0, 160) });
      continue;
    }
    staged.set(path, result.text);
    appliedMethods.push({ path, method: result.method, ambiguous: result.ambiguous });
  }

  if (failures.length) {
    return { applied: false, outputs: null, changedPaths, failures, safetyViolation: false, safetyReason: null, appliedMethods };
  }

  return {
    applied: true,
    outputs: Object.fromEntries(changedPaths.map(path => [path, staged.get(path)])),
    changedPaths,
    failures: [],
    safetyViolation: false,
    safetyReason: null,
    appliedMethods
  };
}

export function describeEditFailures(result) {
  if (!result || result.applied) return '';
  return (result.failures || [])
    .map(failure => `${failure.path || 'batch'}: ${failure.reason}${failure.searchPreview ? ` [search: ${failure.searchPreview}]` : ''}`)
    .join('; ');
}
