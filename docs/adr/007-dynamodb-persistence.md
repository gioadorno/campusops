# ADR 007: DynamoDB persistence model

- Status: Accepted
- Date: 2026-08-13

Use a single operational table for requests, idempotency records, and service status, with typed PK prefixes and a user/creation-time GSI. Use a separate audit table because audit retention and access differ. Both use on-demand billing, encryption, and point-in-time recovery. Policies remain in memory until Phase 3.
