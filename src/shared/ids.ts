export type SessionId = string & { __brand: "SessionId" };
export type RpcRequestId = string & { __brand: "RpcRequestId" };
export type WorkspaceId = string & { __brand: "WorkspaceId" };
export type EntryId = string & { __brand: "EntryId" };

let rpcIdCounter = 0;
export function newRpcRequestId(): RpcRequestId {
  return `rpc-${Date.now()}-${++rpcIdCounter}` as RpcRequestId;
}

let sessionIdCounter = 0;
export function newSessionId(): SessionId {
  return `ses-${Date.now()}-${++sessionIdCounter}` as SessionId;
}
