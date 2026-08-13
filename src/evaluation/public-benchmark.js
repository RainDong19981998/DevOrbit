import { createHash } from 'node:crypto';

function valueTypeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return typeof value === type;
}

export function validateJsonSchema(value, schema, root = schema, path = '$') {
  if (schema?.$ref) {
    if (!schema.$ref.startsWith('#/')) return [`${path} uses unsupported external $ref`];
    const target = schema.$ref.slice(2).split('/').reduce((current, key) => current?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], root);
    return target ? validateJsonSchema(value, target, root, path) : [`${path} has unresolved $ref ${schema.$ref}`];
  }
  const errors = [];
  const types = Array.isArray(schema?.type) ? schema.type : [schema?.type].filter(Boolean);
  if (types.length && !types.some(type => valueTypeMatches(value, type))) return [`${path} must be ${types.join(' or ')}`];
  if (schema?.const !== undefined && value !== schema.const) errors.push(`${path} must equal ${JSON.stringify(schema.const)}`);
  if (schema?.enum && !schema.enum.some(item => Object.is(item, value))) errors.push(`${path} must be one of ${schema.enum.join(', ')}`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} must contain at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} must contain at most ${schema.maxLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path} must match ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} must contain at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} must contain at most ${schema.maxItems} items`);
    if (schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) errors.push(`${path} items must be unique`);
    if (schema.items) value.forEach((item, index) => errors.push(...validateJsonSchema(item, schema.items, root, `${path}[${index}]`)));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) if (value[key] === undefined) errors.push(`${path} missing ${key}`);
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties || {}, key)) errors.push(`${path} has unknown ${key}`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (value[key] !== undefined) errors.push(...validateJsonSchema(value[key], childSchema, root, `${path}.${key}`));
    }
  }
  return errors;
}

export function wilsonInterval(successes, total, z = 1.96) {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || total < 0 || successes < 0 || successes > total) throw new Error('invalid binomial counts');
  if (!total) return null;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total) / denominator;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin), successes, total, confidence: 0.95 };
}

function seededRandom(seed) {
  let state = createHash('sha256').update(String(seed)).digest().readUInt32LE(0) || 1;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function bootstrapMean(values, { seed = 'devorbit-bootstrap-v1', replicates = 10000 } = {}) {
  const numeric = values.filter(value => Number.isFinite(value));
  if (!numeric.length) return null;
  if (!Number.isInteger(replicates) || replicates < 1000 || replicates > 100000) throw new Error('bootstrap replicates must be 1000..100000');
  const random = seededRandom(seed);
  const means = [];
  for (let i = 0; i < replicates; i++) {
    let sum = 0;
    for (let j = 0; j < numeric.length; j++) sum += numeric[Math.floor(random() * numeric.length)];
    means.push(sum / numeric.length);
  }
  means.sort((a, b) => a - b);
  const quantile = p => means[Math.min(means.length - 1, Math.floor(p * means.length))];
  return { mean: numeric.reduce((sum, value) => sum + value, 0) / numeric.length, low: quantile(0.025), high: quantile(0.975), confidence: 0.95, n: numeric.length, replicates, seed };
}

export function metricFromBoolean(rows, field) {
  const observed = rows.filter(row => typeof row[field] === 'boolean');
  const successes = observed.filter(row => row[field]).length;
  return { value: observed.length ? successes / observed.length : null, interval: wilsonInterval(successes, observed.length), numerator: successes, denominator: observed.length, excluded: rows.length - observed.length };
}

export function metricFromNumber(rows, field, seed) {
  const values = rows.map(row => row[field]).filter(value => Number.isFinite(value));
  return { value: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null, interval: bootstrapMean(values, { seed }), numerator: values.length, denominator: rows.length, excluded: rows.length - values.length };
}

function binomialCdf(k, n) {
  if (k < 0) return 0;
  let probability = 2 ** (-n);
  let sum = probability;
  for (let i = 1; i <= k; i++) {
    probability *= (n - i + 1) / i;
    sum += probability;
  }
  return sum;
}

export function pairedBinaryComparison(leftRows, rightRows, field, { seed = `paired:${field}` } = {}) {
  const left = new Map(leftRows.map(row => [row.caseId, row]));
  const pairs = rightRows
    .filter(row => left.has(row.caseId) && typeof row[field] === 'boolean' && typeof left.get(row.caseId)[field] === 'boolean')
    .map(row => ({ caseId: row.caseId, left: left.get(row.caseId)[field], right: row[field] }));
  const leftOnly = pairs.filter(pair => pair.left && !pair.right).length;
  const rightOnly = pairs.filter(pair => !pair.left && pair.right).length;
  const discordant = leftOnly + rightOnly;
  const exactP = discordant ? Math.min(1, 2 * binomialCdf(Math.min(leftOnly, rightOnly), discordant)) : 1;
  const effect = bootstrapMean(pairs.map(pair => Number(pair.left) - Number(pair.right)), { seed });
  return { field, pairs: pairs.length, leftOnly, rightOnly, discordant, mcnemarExactP: exactP, riskDifference: effect, pairIds: pairs.map(pair => pair.caseId) };
}
