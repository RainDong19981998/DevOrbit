import { readFile } from 'node:fs/promises';
import { IdempotencyLedger } from '../src/adapters/platforms.js';

const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : null;
};
const required = name => {
  const value = option(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
};
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

const directory = required('directory');
const namespace = required('namespace');
const key = required('key');
const input = await readJson(required('input'));
const result = await readJson(required('result'));
const evidenceRef = required('evidence-ref');
const ledger = new IdempotencyLedger({ directory, namespace });
const reconciled = await ledger.reconcile(key, input, result, { evidenceRef });
console.log(JSON.stringify({ status: 'reconciled', namespace, key, evidenceRef, result: reconciled }));
