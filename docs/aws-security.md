# AWS Security Boundaries

## Identity layers

- Authentication: API Gateway validates Cognito issuer, audience, signature, and token lifetime. Both `/mcp` routes also require at least one `campusops/*` custom OAuth scope as an edge-level baseline.
- Application authorization: a fixed mapping converts `campusops/*.read|write` OAuth scopes to the existing colon-delimited scopes; unsupported scopes are ignored. `CampusOpsService` enforces each operation.
- Ownership: Cognito `sub` is the user ID. No MCP argument can supply it. Cross-user and missing records remain externally indistinguishable.
- Runtime permissions: the Lambda role can read/write only the operational table and its GSI, write only the audit table, and write its known log group.
- Deployment permissions: a separate GitHub OIDC role is trusted only for `repo:gioadorno/campusops:environment:dev`. It cannot be assumed with long-lived AWS keys from this workflow.

## Bootstrap and deployment boundary

Bootstrap Terraform is an operator-owned control plane. It owns the encrypted/versioned state bucket, GitHub OIDC provider, GitHub deployment role, trust policy, and deployment-role policy in separate local state. Normal dev Terraform cannot create, delete, or change those identities. In particular, the deployment role has no permission to modify or delete itself and no permission to manage the GitHub OIDC provider.

The deployment role can manage only the exact `campusops-dev-runtime` Lambda role. `iam:PassRole` names that role alone and requires `iam:PassedToService = lambda.amazonaws.com`; it cannot pass itself. Cognito user-pool, app-client, resource-server, domain, and managed-login-branding CRUD is constrained to user-pool ARNs in the configured region/account with matching `Project=CampusOps` and `Environment=dev` resource tags. Branding permissions include create, both Terraform read paths, update, delete, and the user-pool-client listing used by provider refresh. DynamoDB permissions include TTL and PITR read/update calls and remain scoped to `campusops-dev-*` table ARNs. CloudWatch dashboard/alarm permissions include their read and tag synchronization calls and remain scoped to CampusOps dashboard/alarm ARNs.

The deployment policy has exactly three `Resource = "*"` exceptions, each isolated to the minimum individual AWS API action:

- `cognito-idp:CreateUserPool`: no user-pool ARN exists before creation; `Project=CampusOps` and `Environment=dev` request-tag conditions still apply.
- `cognito-idp:DescribeUserPoolDomain`: Cognito does not support resource-level authorization for this read operation.
- `logs:DescribeLogGroups`: CloudWatch Logs implements this Terraform refresh operation as an account-level list.

No mutation is grouped into either describe wildcard statement. Resource ARNs and request/resource tag conditions remain in place wherever AWS supports them.

The runtime policy contains no `Action = "*"` or `Resource = "*"`. The log-stream suffix and named CampusOps ARN suffixes are needed because streams/resources are created below known parents. Deployment actions are enumerated and confined to CampusOps names, region, account, and tags where AWS supports them. The provider implementation was audited for Terraform CRUD/refresh calls, including Lambda permission `GetPolicy` and IAM runtime-role list/read behavior. Review and tighten further from CloudTrail after the first controlled deployment.

API Gateway's route-scope requirement is not an authorization substitute: it accepts any one CampusOps scope, while `CampusOpsService` still enforces the exact scope for every tool, resource, and prompt. Lambda direct invocation is restricted by IAM. The Lambda principal mapper rejects missing/malformed subjects and claims. Origin validation is repeated in Lambda, never uses `*`, and protects browser clients against hostile origins/DNS rebinding; non-browser clients may omit Origin.

Audit records omit tokens, claims, tool inputs/results, policy bodies, descriptions, and secrets. Both DynamoDB tables use encryption and point-in-time recovery. Terraform state is sensitive: bootstrap enables S3 encryption, versioning, public-access blocking, and native `.tflock` locking. Access is limited to the deployment role and operators.

GitHub workflow changes can alter infrastructure. Protect `master`, require review for `.github/` and `infrastructure/`, configure reviewers on the `dev` environment, pin/monitor third-party actions, and restrict who may approve deployments. No alarm destinations are created until an explicit notification target exists.
