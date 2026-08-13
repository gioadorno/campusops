# ADR 001: Keep domain behavior transport-independent

- Status: Accepted
- Date: 2026-08-13

## Context

CampusOps needs Streamable HTTP now, optional stdio for developer workflows, and future infrastructure adapters without duplicating security logic.

## Decision

MCP registration callbacks are thin mappings to a transport-neutral application service. Authentication produces a common principal. Authorization, ownership, idempotency, and audit lifecycle reside below the MCP adapter. Repositories and audit sinks are injected interfaces or replaceable adapters.

## Consequences

Security behavior can be unit tested without a protocol connection and reused across HTTP and stdio. There is modest indirection and dependency wiring, which is intentional for future persistence and identity adapters.
