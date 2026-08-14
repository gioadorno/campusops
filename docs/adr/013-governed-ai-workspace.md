# ADR-013: Governed AI workspace tool execution

## Status

Accepted for Phase 3A.

## Decision

CampusOps uses a Next.js backend-for-frontend with server-managed Cognito PKCE sessions and a provider-neutral orchestration package backed by Bedrock Converse. Existing MCP Zod schemas become model tool definitions. A deterministic application policy automatically executes four read-only tools and pauses the two state-changing tools for explicit human approval.

Approval is server-owned, expiring, single-use, identity/session/conversation scoped, and payload-bound. The browser approves an opaque proposal ID; it never resubmits the tool or arguments. Every execution uses the authenticated MCP client and remains subject to `CampusOpsService` authorization, ownership, validation, idempotency, and audit.

## Consequences

The model can propose but cannot authorize or directly execute privileged work. The browser never holds AWS credentials or raw Cognito tokens. Phase 3A process-local stores make the reference workspace inexpensive and simple but do not survive restart or support horizontal scaling; durable storage and hosted runtime design are deferred. Bedrock Knowledge Bases, OpenSearch, RAG, and AgentCore remain outside this decision.
