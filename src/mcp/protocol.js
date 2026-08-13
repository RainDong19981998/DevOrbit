export { MCP_PROTOCOL_VERSION } from '../version.js';

export function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

export function rpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}
