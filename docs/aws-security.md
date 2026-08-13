# AWS Security Boundaries

## Identity layers

- Authentication: API Gateway validates Cognito issuer, audience, signature, and token lifetime. Both `/mcp` routes also require at least one `campusops/*` custom OAuth scope as an edge-level baseline.
- Application authorization: a fixed mapping converts `campusops/*.read|write` OAuth scopes to the existing colon-delimited scopes; unsupported scopes are ignored. `CampusOpsService` enforces each operation.
- Ownership: Cognito `sub` is the user ID. No MCP argument can supply it. Cross-user and missing records remain externally indistinguishable.
- Runtime permissions: the Lambda role can read/write only the operational table and its GSI, write only the audit table, and write its known log group.
- Deployment permissions: a separate GitHub OIDC role is trusted only for `repo:gioadorno/campusops:environment:dev`. It cannot be assumed with long-lived AWS keys from this workflow.

## Bootstrap and deployment boundary

Bootstrap Terraform is an operator-owned control plane. It owns the encrypted/versioned state bucket, GitHub OIDC provider, GitHub deployment role, trust policy, and deployment-role policy in separate local state. Normal dev Terraform cannot create, delete, or change those identities. In particular, the deployment role has no permission to modify or delete itself and no permission to manage the GitHub OIDC provider.

The deployment role can manage only the exact `campusops-dev-runtime` Lambda role. `iam:PassRole` names that role alone and requires `iam:PassedToService = lambda.amazonaws.com`; it cannot pass itself. Cognito `CreateUserPool` is the documented exception that requires `Resource = "*"` because no pool ARN exists yet. That statement requires `Project=CampusOps` and `Environment=dev` request tags. Subsequent Cognito actions are constrained to user pools in the configured region/account and require matching resource tags.

The runtime policy contains no `Action = "*"` or `Resource = "*"`. The log-stream suffix and named CampusOps ARN suffixes are needed because streams/resources are created below known parents. Deployment actions are enumerated and confined to CampusOps names, region, account, and tags where AWS supports them. Review and tighten them further from CloudTrail after the first controlled deployment.

API Gateway's route-scope requirement is not an authorization substitute: it accepts any one CampusOps scope, while `CampusOpsService` still enforces the exact scope for every tool, resource, and prompt. Lambda direct invocation is restricted by IAM. The Lambda principal mapper rejects missing/malformed subjects and claims. Origin validation is repeated in Lambda, never uses `*`, and protects browser clients against hostile origins/DNS rebinding; non-browser clients may omit Origin.

Audit records omit tokens, claims, tool inputs/results, policy bodies, descriptions, and secrets. Both DynamoDB tables use encryption and point-in-time recovery. Terraform state is sensitive: bootstrap enables S3 encryption, versioning, public-access blocking, and native `.tflock` locking. Access is limited to the deployment role and operators.

GitHub workflow changes can alter infrastructure. Protect `master`, require review for `.github/` and `infrastructure/`, configure reviewers on the `dev` environment, pin/monitor third-party actions, and restrict who may approve deployments. No alarm destinations are created until an explicit notification target exists.
