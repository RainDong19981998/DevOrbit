export { MCP_LATEST_PROTOCOL_VERSION, MCP_PROTOCOL_VERSION, MCP_PROTOCOL_VERSIONS } from '../version.js';
import { MCP_LATEST_PROTOCOL_VERSION, MCP_PROTOCOL_VERSIONS } from '../version.js';

export function negotiateProtocolVersion(requested) {
  return MCP_PROTOCOL_VERSIONS.includes(requested) ? requested : MCP_LATEST_PROTOCOL_VERSION;
}

export function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

export function rpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}
