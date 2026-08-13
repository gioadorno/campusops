# ADR 009: Durable audit strategy

- Status: Accepted
- Date: 2026-08-13

Write the safe `AuditEvent` contract to a dedicated DynamoDB table indexed by trace and user/time. Lambda can only append with `PutItem`. Payloads, descriptions, tokens, claims, policy bodies, results, and secrets are excluded. Structured CloudWatch logs mirror only safe operational fields.
