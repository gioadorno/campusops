# ADR 002: Use a signed local JWT-compatible authentication adapter

- Status: Accepted for Phase 1
- Date: 2026-08-13

## Context

The local gateway needs realistic identity and scope claims without deploying an authorization server or AWS infrastructure.

## Decision

Use HS256-signed, issuer-checked, expiring JWTs behind a `TokenVerifier` interface. Required claims are subject, session ID, and an allow-listed scope array. HTTP accepts bearer tokens; application services consume only the verified principal.

## Consequences

Local tests exercise actual signed credentials while identity remains replaceable. Shared-secret signing and the development default are not production choices. A later phase should use a dedicated OIDC authorization server, asymmetric verification, audience validation, key rotation, and discovery metadata.
