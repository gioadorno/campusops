# AWS Security Boundaries

## Identity layers

- Authentication: API Gateway validates Cognito issuer, audience, signature, and token lifetime.
- Application authorization: a fixed mapping converts `campusops/*.read|write` OAuth scopes to the existing colon-delimited scopes; unsupported scopes are ignored. `CampusOpsService` enforces each operation.
- Ownership: Cognito `sub` is the user ID. No MCP argument can supply it. Cross-user and missing records remain externally indistinguishable.
- Runtime permissions: the Lambda role can read/write only the operational table and its GSI, write only the audit table, and write its known log group.
- Deployment permissions: a separate GitHub OIDC role is trusted only for `repo:gioadorno/campusops:environment:dev`. It cannot be assumed with long-lived AWS keys from this workflow.

The runtime policy contains no `Action = "*"` or `Resource = "*"`. The log-stream suffix and named CampusOps ARN suffixes are needed because streams/resources are created below known parents. Some Terraform control-plane operations require service-level paths; the deployment policy enumerates actions and confines ARNs to CampusOps names, region, and account. Review and tighten it further from CloudTrail after the first controlled deployment.

API Gateway is not an authorization substitute, and Lambda direct invocation is restricted by IAM. The Lambda principal mapper rejects missing/malformed subjects and claims. Origin validation is repeated in Lambda, never uses `*`, and protects browser clients against hostile origins/DNS rebinding; non-browser clients may omit Origin.

Audit records omit tokens, claims, tool inputs/results, policy bodies, descriptions, and secrets. Both DynamoDB tables use encryption and point-in-time recovery. Terraform state is sensitive: bootstrap enables S3 encryption, versioning, public-access blocking, and native `.tflock` locking. Access is limited to the deployment role and operators.

GitHub workflow changes can alter infrastructure. Protect `master`, require review for `.github/` and `infrastructure/`, configure reviewers on the `dev` environment, pin/monitor third-party actions, and restrict who may approve deployments. No alarm destinations are created until an explicit notification target exists.
