# AWS Architecture

Phase 2 adds an AWS adapter around the unchanged CampusOps application service.

```text
Cognito OAuth 2.0 (authorization code + PKCE)
  → API Gateway HTTP API JWT authorizer
  → Lambda API Gateway/MCP transport adapter
  → MCP adapter
  → CampusOpsService (scope + ownership authorization)
  → repository/provider interfaces
      ├─ InMemoryPolicyRepository (Phase 3 migration seam)
      ├─ DynamoDbServiceRepository
      ├─ DynamoDbSupportRequestRepository
      ├─ StaticPlatformCapabilitiesProvider
      └─ DynamoDbAuditSink (separate table)
```

API Gateway authenticates access tokens and requires either MCP route to carry at least one CampusOps custom scope. It still cannot authorize individual MCP operations because every operation shares `/mcp`. Lambda maps the verified Cognito `sub` and external OAuth scopes to a transport-neutral `Principal`; tool arguments cannot alter identity. `CampusOpsService` continues to enforce the exact scope for tools, resources, and prompts.

The Lambda adapter uses the SDK v2 stateless HTTP handler. `POST /mcp` preserves MCP headers and JSON-RPC behavior. Authenticated `GET /mcp` returns 405 because Phase 2 has no server-initiated SSE or sessionful behavior. Missing Origin is accepted for non-browser clients; present origins must exactly match `ALLOWED_ORIGINS`.

The operational table uses request, idempotency, and service entity prefixes. GSI1 lists requests by authenticated user and creation time. Idempotency records have TTL and are transactionally inserted with support requests. Audit events use a separate encrypted, point-in-time recoverable table and contain only the existing safe event contract.

Bootstrap Terraform separately owns remote state and GitHub OIDC deployment identity. The application deployment state owns only the Lambda runtime role and CampusOps application resources, preventing the workflow role from modifying its own trust or permissions.

CloudWatch receives structured, payload-free operation logs, finite-retention Lambda logs, a dashboard, and alarms for Lambda errors, API 5xx, and DynamoDB throttles. All development compute and storage are serverless/on-demand; no always-on service is provisioned.

Policies remain fictional and in memory intentionally. Bedrock, RAG, Knowledge Bases, OpenSearch, AgentCore, and a chat frontend are Phase 3 work.
