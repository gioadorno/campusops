# Architecture

## Context and boundaries

CampusOps exposes fictional policy, service, and support-request capabilities to MCP clients. The trusted computing base is the gateway process and its configured verifier. The LLM, host-supplied prompt text, tool arguments, MCP client, and network input are untrusted.

```text
┌──────────────┐       bearer JWT       ┌────────────────────────────┐
│ MCP host/LLM │ ── Streamable HTTP ──▶ │ HTTP authentication adapter │
└──────────────┘                         └─────────────┬──────────────┘
                                                    │ Principal
                      ┌─────────────────────────────▼──────────────┐
                      │ MCP adapter (tools/resources/prompts)      │
                      └─────────────────────────────┬──────────────┘
                                                    │ typed call
                      ┌─────────────────────────────▼──────────────┐
                      │ Application service                        │
                      │ scope checks · ownership · idempotency     │
                      └──────────────┬─────────────────┬───────────┘
                                     │                 │
                            ┌────────▼────────┐  ┌─────▼──────────┐
                            │ In-memory repos │  │ AuditSink      │
                            └─────────────────┘  └────────────────┘
```

## Domain boundaries

- Transport accepts protocol messages and does not make domain decisions.
- MCP adapter maps protocol names and results to typed application calls.
- Application service owns authorization, ownership, operation sequencing, and audit lifecycle.
- Repositories own data access and user-scoped idempotency state.
- Contracts own validation constraints shared across adapters.
- Authentication turns credentials into a transport-neutral `Principal`.
- Auditing accepts metadata only and has no access to sensitive operation arguments.

## Runtime state

Repositories and the audit sink are process-wide dependencies shared across stateless HTTP MCP handler instances. MCP server instances are request-scoped under the v2 HTTP handler. This preserves idempotency across protocol requests while avoiding protocol session state. Stdio receives one server factory over a persistent process connection but uses the same dependencies.

Phase 1 restart behavior is intentionally ephemeral. Support records, idempotency mappings, and audit events reset when the process exits.

## Failure behavior

- Authentication failures are HTTP 401 responses.
- Validation failures are MCP protocol/tool validation failures produced by the SDK.
- Scope, ownership, not-found, and conflict failures are tool-level `isError` results so clients can reason about the refusal without terminating the connection.
- Audit writes occur in `finally`. The in-memory sink cannot fail in Phase 1; a production sink needs an explicit fail-open/fail-closed policy and buffering design.

## Future evolution

Repository, verifier, and audit interfaces are dependency-injection boundaries. A future deployment can add durable databases, managed identity, append-only audit delivery, caching, rate limits, tracing propagation, and horizontally scaled instances without embedding those concerns into MCP registrations.

## Phase 3A workspace boundary

```text
Browser
  │ opaque HttpOnly session + CSRF token
  ▼
Next.js workspace BFF ── AWS SDK ──▶ Bedrock Converse (tool proposal only)
  │                                      │
  │ server-owned Cognito access token    ├─ read tool ───────────┐
  │                                      └─ write tool ─▶ approval store
  │                                                            │ user approves
  └──────────────── authenticated MCP client ◀──────────────────┘
                           │
                           ▼
             API Gateway JWT → Lambda MCP → CampusOpsService
                           │
                    authorization · ownership · idempotency · audit
```

`apps/workspace` is a backend-for-frontend. Browser code cannot access Cognito tokens, AWS credentials, Bedrock, or MCP infrastructure identifiers. OAuth login state and PKCE verifier are one-time server records; successful callback handling verifies signed access and ID tokens and redirects away from the authorization-code URL. The opaque session is bound to the Cognito subject and expires no later than the access token.

`packages/ai` is independent of React and Next.js. Its Bedrock provider accepts a typed conversation and provider-neutral tool definitions. Definitions come from the existing MCP Zod contracts. Its deterministic policy, not the model description, classifies the four read operations as automatic and the two write operations as approval-required. The MCP gateway remains the final authority for exact scopes, ownership, validation, execution, idempotency, and audit.

When a model proposes several tools in one response, the orchestrator executes the batch only if every proposal is known, valid, scope-eligible, and read-only. A batch containing any write or invalid proposal executes nothing. Rejected human approvals return a deterministic no-change response without another model invocation.

Pending approvals are random, expiring, single-use records scoped to user, session, and conversation and bound by a SHA-256 fingerprint to the exact server-side tool proposal. Approval routes accept an ID and decision, never browser-supplied replacement arguments. Process-local session/conversation/approval stores are an explicit Phase 3A reference limitation and repository seams for later durable implementations.

Each workspace turn receives a random correlation ID. It is attached to Bedrock request metadata, safe workspace diagnostics, and an allow-listed MCP header. The HTTP/Lambda adapter accepts only UUID-shaped correlation values and propagates the value into the existing CampusOps audit `traceId`; otherwise it generates the normal server trace ID.
