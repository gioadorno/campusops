# ADR 008: Durable idempotency transactions

- Status: Accepted
- Date: 2026-08-13

Bind `(userId, idempotencyKey)` to the canonical Phase 1 SHA-256 payload fingerprint. Create the idempotency and request items in one conditional transaction. A loser consistently rereads the winner and applies same-payload retry or different-payload conflict semantics. TTL bounds record lifetime.
