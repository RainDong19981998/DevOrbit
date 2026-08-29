import { createServer } from 'node:http';

const port = Number(process.env.PORT || 4901);
const faultRate = Number(process.env.FAULT_RATE || 0);
const version = process.env.SERVICE_VERSION || 'stable';
const ordersByKey = new Map();

createServer((req, res) => {
  const at = process.hrtime.bigint();
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', version }));
    return;
  }
  if (req.method === 'POST' && req.url === '/orders') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body || '{}'); } catch { parsed = {}; }
      if (faultRate > 0 && Math.random() < faultRate) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'injected fault', version }));
        return;
      }
      const key = parsed.idempotencyKey || 'anonymous';
      const existing = ordersByKey.get(key);
      if (existing) {
        res.writeHead(409, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 409, order: existing, version }));
        return;
      }
      const order = { id: `ORD-${ordersByKey.size + 1}`, payload: parsed.payload || null };
      ordersByKey.set(key, order);
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 201, order, version }));
    });
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(port, '0.0.0.0', () => console.log(`canary-service ${version} on ${port} faultRate=${faultRate}`));
