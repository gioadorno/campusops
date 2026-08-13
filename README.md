# CampusOps MCP Gateway

CampusOps MCP Gateway is a fictional enterprise Model Context Protocol (MCP) platform. Phase 1 established the local secure MCP foundation. Phase 2 adds an AWS serverless production foundation while preserving the application/domain contracts.

MCP is an open protocol that gives AI applications a standard way to discover and invoke tools, read contextual resources, and use reusable prompt templates. MCP does not replace application security: the model proposes a call, while this gateway validates and authorizes it.

No real university data or branding is used.

## Architecture

```text
Local: MCP client → HTTP/stdio → LocalJwtAuth → CampusOpsService → InMemory adapters

AWS:   Cognito → API Gateway JWT authorizer → Lambda MCP adapter
                                               ↓ Principal
                                          CampusOpsService
                                               ↓ interfaces
               ┌───────────────────────────────┼──────────────────────────────┐
        InMemory policies            DynamoDB operations             DynamoDB audit
```

The monorepo uses pnpm workspaces:

- `apps/mcp-server`: HTTP/stdio entrypoints, MCP adapter, application services, repository interfaces/in-memory adapters, fictional data, and tests.
- `apps/mcp-client`: v2 SDK client and end-to-end MCP contract tests.
- `packages/contracts`: shared Zod input schemas and domain contracts.
- `packages/auth`: signed local JWT issuer/verifier, principals, and scope checks.
- `packages/audit`: transport-independent audit event contract and in-memory sink.
- `packages/config`: validated local runtime configuration.
- `packages/aws`: validated AWS configuration and AWS client construction.
- `infrastructure`: Terraform bootstrap, reusable modules, and the dev environment.
- `docs`: architecture, MCP design, threat model, and decision records.

Business logic never lives in transport setup or directly in the registration callbacks. `Dependencies` references only the `PolicyRepository`, `ServiceRepository`, and `SupportRequestRepository` interfaces; `createDependencies()` selects their `InMemory*Repository` Phase 1 adapters. Tools and all five resources therefore follow the same transport → adapter → application service → repository interface → adapter path. Persistent adapters can replace them without changing MCP contracts or application behavior.

## MCP surface

| Kind     | Name                           | Required scope   | Security behavior                       |
| -------- | ------------------------------ | ---------------- | --------------------------------------- |
| Tool     | `search_policies`              | `policies:read`  | Read-only, bounded query and limit      |
| Tool     | `get_service_status`           | `services:read`  | Read-only                               |
| Tool     | `list_support_requests`        | `requests:read`  | Derives user from principal             |
| Tool     | `get_support_request`          | `requests:read`  | Enforces ownership                      |
| Tool     | `create_support_request`       | `requests:write` | User-scoped idempotency key             |
| Tool     | `cancel_support_request`       | `requests:write` | Enforces ownership                      |
| Resource | `policy://catalog`             | `policies:read`  | Catalog metadata                        |
| Resource | `policy://categories/security` | `policies:read`  | Fictional security policies             |
| Resource | `services://catalog`           | `services:read`  | Fictional service status                |
| Resource | `support://categories`         | `requests:read`  | Allowed categories                      |
| Resource | `platform://capabilities`      | none             | Public capability summary               |
| Prompt   | `triage-support-request`       | `requests:read`  | Treats supplied issue text as untrusted |
| Prompt   | `policy-answer`                | `policies:read`  | Requires evidence and policy IDs        |

Prompts are guidance, not privileged execution. They cannot bypass tool handlers.

## Authorization

HTTP requests require a signed bearer JWT. The local implementation is JWT-compatible and deliberately small: it validates signature, issuer, expiry, subject (`userId`), session ID, and an allow-listed scope array. It is an abstraction behind `TokenVerifier`, so a future OAuth/OIDC verifier can replace it.

Available scopes are `policies:read`, `services:read`, `requests:read`, `requests:write`, and `admin:audit`. The HTTP boundary authenticates once. Every application operation then authorizes independently; user identity is never a support-tool argument. Ownership is checked after locating a support request and before returning or changing it. Ownership denials are audited as denied authorization with `denialReason: "ownership"`; scope denials use `denialReason: "scope"`.

`JWT_SECRET` must be at least 32 characters. Development and test may use the checked-in local fallback. Production fails closed unless `JWT_SECRET` is explicitly supplied, and it rejects the development fallback even when explicitly configured.

## Audit system

Executable tools, resource reads, and prompt retrievals pass through a common audit wrapper. It records `eventId`, `traceId`, `userId`, `sessionId`, action, operation/tool name, authorization decision, optional scope/ownership denial reason, required scopes, duration, result, and timestamp on success, denial, or error. It intentionally omits tool arguments, descriptions, policy bodies, token values, and result payloads. The Phase 1 sink is in-memory and implements a replaceable `AuditSink` interface.

MCP-facing errors are normalized. Missing and cross-user support records both return `Resource not found or unavailable`, preventing ownership probing. Expected authorization and conflict failures use bounded public messages; unexpected internal exception names and messages are never returned to callers.

## Run locally

Requirements: Node.js 20+ and pnpm 10+.

```bash
pnpm install
pnpm build
JWT_SECRET='replace-with-a-local-secret-at-least-32-characters' pnpm dev:server
```

The HTTP endpoint is `http://127.0.0.1:3000/mcp`. A client must supply `Authorization: Bearer <signed-local-token>`. For local MCP hosts that spawn a process, run the stdio adapter:

```bash
pnpm --filter @campusops/mcp-server stdio
```

The stdio adapter uses the same server factory, application service, repositories, authorization checks, and audit sink. Its fixed development principal is suitable only for local testing.

Runtime mode is explicit: local entrypoints use `CAMPUSOPS_RUNTIME=local` semantics and `LocalJwtAuth`; Lambda requires `CAMPUSOPS_RUNTIME=aws`, Cognito/API Gateway identity, DynamoDB table names, region, environment, and an exact comma-separated `ALLOWED_ORIGINS`. AWS mode does not use or require `JWT_SECRET`.

## AWS mode

Phase 2 provisions Cognito authorization-code/PKCE authentication, an API Gateway HTTP API JWT authorizer, stateless Lambda MCP execution, on-demand DynamoDB operational/audit tables, finite-retention CloudWatch logs, dashboard/alarms, and separate least-privilege runtime/deployment IAM roles. External `campusops/*.read|write` OAuth scopes map explicitly to the unchanged internal scopes. API Gateway authenticates; `CampusOpsService` still authorizes every tool, resource, and prompt and enforces record ownership.

Support-request and service repositories are durable DynamoDB adapters. Idempotency uses a conditional transaction to atomically create the fingerprint record and request; concurrent losers consistently reread the winner. Audit events are append-only writes to a separate table and never contain MCP payloads or credentials. Policy retrieval intentionally remains `InMemoryPolicyRepository` until the Phase 3 knowledge architecture.

Build the deterministic Lambda artifact with `pnpm build:lambda`. Terraform is organized under `infrastructure/modules`, with a one-time S3 state bootstrap and a dev composition using native S3 lockfiles. The manual **Deploy dev** GitHub workflow runs through the protected `dev` environment and assumes an AWS role with OIDC—never permanent AWS access-key secrets. See [AWS architecture](docs/aws-architecture.md), [AWS security](docs/aws-security.md), and [deployment](docs/deployment.md).

## Validation and contract tests

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:contract
```

The contract suite starts an ephemeral local HTTP server and uses the official MCP v2 client to list tools/resources/prompts, read every resource, get a prompt, invoke every read-only tool, test create/cancel behavior, prove same-payload retries create once, reject conflicting payload reuse, and verify scope and ownership failures. Idempotency records are scoped by user and store a SHA-256 fingerprint over canonical `category`, `title`, `description`, and `severity` fields.

GitHub Actions runs the frozen-lockfile install, lint, typecheck, unit/integration tests, build, and dedicated contract suite for every pull request and push to `master` using Node 20 and pnpm 10.33.0.
Pull requests also run Terraform formatting, backend-free initialization, and validation; they never apply infrastructure.

## Protocol compatibility

The server uses the official split MCP TypeScript SDK v2 packages. `createMcpHandler` serves the modern protocol and its stateless 2025-era compatibility path from one registration factory and endpoint. See [ADR 003](docs/adr/003-mcp-version-compatibility.md).

## Future AWS architecture

Phase 1 intentionally implements none of this. A future phase can place a hardened HTTP ingress and WAF in front of containerized gateway instances; use an external OIDC provider and short-lived tokens; move support and idempotency state to a transactional datastore; move policy documents to versioned object storage plus a search index; publish immutable audit events to a durable encrypted pipeline; manage secrets in a dedicated secret manager; and add centralized metrics, traces, alarms, and deployment controls. The existing transport, service, repository, verifier, and audit interfaces are seams for that evolution.

## Security considerations

Inputs are strict and bounded, scopes are least-privilege, side effects require explicit write permission, idempotency is user-scoped and payload-bound, ownership is enforced server-side with non-enumerating public errors, production JWT configuration fails closed, and audit payloads exclude sensitive content. MCP metadata is treated as untrusted presentation data rather than authority. See [the threat model](docs/threat-model.md) for attack-specific controls and residual risks.

## Phase 2 limitations

Lambda supports stateless MCP `POST /mcp`; authenticated `GET /mcp` returns 405 because SSE/server-initiated streams and sessionful MCP are not supported. Phase 2 does not contain Amazon Bedrock invocation, Bedrock Knowledge Bases, OpenSearch, RAG, AgentCore Gateway, or a frontend/chat application. Those remain Phase 3 work.
