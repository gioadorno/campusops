# ADR 004: Serverless AWS deployment

- Status: Accepted
- Date: 2026-08-13

Use API Gateway HTTP API, Lambda Node.js 22, and on-demand DynamoDB for the development deployment. These cost-conscious managed services preserve the existing transport/application/repository boundaries without always-on capacity. Cold starts and Lambda duration limits are accepted Phase 2 constraints.
