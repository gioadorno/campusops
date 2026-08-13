# ADR 003: MCP version compatibility

- Status: Accepted
- Date: 2026-08-13

## Context

The official TypeScript SDK v2 supports the modern 2026 protocol era while deployed clients may still speak 2025-era MCP. CampusOps needs modern behavior without forking business or registration logic.

## Decision

Use the official v2 split packages and `createMcpHandler` as the Streamable HTTP entrypoint. Its default stateless legacy posture serves 2025-era requests while the same factory serves modern requests. Both paths create `McpServer` instances through `createMcpServer`, which registers the identical tools, resources, prompts, authorization calls, and audit behavior.

Stdio uses the v2 `serveStdio` factory over that same registration function. Protocol-era differences stay in SDK transport code. Domain contracts do not branch on protocol version.

## Consequences

- One endpoint and registration source support modern and 2025-era clients.
- Stateless legacy compatibility does not offer sessionful legacy resumability or server-initiated interactions; Phase 1 does not require either.
- Process-wide repositories preserve domain/idempotency state across request-scoped handlers.
- SDK upgrades require contract tests in both auto-negotiated modern operation and, when the compatibility matrix grows, an explicitly pinned legacy test.
- If sessionful legacy behavior becomes necessary, a dedicated compatibility route can be mounted ahead of a modern-only handler without changing application services.

The SDK is pinned to `2.0.0` so a dependency update is an explicit, reviewed compatibility decision.
