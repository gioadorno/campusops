# ADR 006: External OAuth scopes versus internal scopes

- Status: Accepted
- Date: 2026-08-13

Public Cognito scopes use `campusops/policies.read`-style names. A closed mapping converts them to the unchanged `policies:read` application vocabulary. Unknown scopes are ignored and malformed claims rejected, keeping the domain independent of Cognito naming.
