# ADR 005: Cognito and API Gateway identity boundary

- Status: Accepted
- Date: 2026-08-13

API Gateway authenticates Cognito access tokens. Lambda accepts only authorizer claims, maps `sub` to CampusOps user identity, and never reads identity from tool arguments. Authentication at the edge does not replace operation authorization in `CampusOpsService`.
