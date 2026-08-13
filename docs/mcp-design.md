# MCP Design

## Design principles

The MCP surface is small, explicit, and task-oriented. Read and write operations are separate, user identity never appears in tool input, limits are bounded, and side-effecting calls declare accurate annotations. Tools return JSON as text for broad client compatibility. Resources expose host-selected context. Prompts are reusable instructions and do not grant authority.

## Tools

`search_policies` performs case-insensitive substring search over a fictional in-memory repository. Its result cap prevents unbounded context growth. `get_service_status` performs an exact service lookup.

Support tools always use `Principal.userId`. List filters after binding that identity. Get and cancel load a record, compare ownership, and refuse cross-user access. Create requires `requests:write`; its idempotency index uses `(userId, idempotencyKey)`, so two users may safely choose the same key while retries from one user resolve to the original record.

`cancel_support_request` closes rather than deletes a record, preserving an auditable lifecycle. It refuses already-closed requests instead of silently masking an unexpected repeated user action.

## Resources

Resources are fixed URIs with JSON MIME type. Policy resources require `policies:read`; service catalog requires `services:read`; support categories require `requests:read`. The platform capability summary contains no user data and requires no scope. Resource callbacks use the same audited authorization wrapper as tools.

## Prompts

`triage-support-request` labels embedded issue text as untrusted and requests classification and safe next steps only. `policy-answer` requires answers grounded in retrieved policy resources, policy ID citations, and clear separation of inference. Prompt retrieval is authorized and audited, but the generated prompt remains advisory.

## Identity and errors

The HTTP gateway authenticates a JWT into a principal. MCP callbacks close over that verified principal; no model-controlled field can override it. The application service is callable without MCP and independently checks scopes, which is why unit tests can prove security behavior without trusting a transport.

Expected domain and authorization failures return a visible tool error. Raw credentials are never returned. SDK-level schema validation rejects malformed or unknown-shaped arguments before business execution.

## Transport

Streamable HTTP is the remote transport. Stdio is a developer convenience with the exact same `createMcpServer` registration factory. The HTTP runtime shares repositories across request-scoped MCP server instances so stateless transport handling does not erase domain state.
