# Development Deployment

## Bootstrap remote state

Bootstrap uses local state and operator/admin credentials. It owns the state bucket and the GitHub OIDC deployment control plane; the normal deployment role must never apply this stack. Choose a globally unique bucket name:

```bash
cd infrastructure/bootstrap
terraform init
terraform apply -var='state_bucket_name=<unique-campusops-state-bucket>'
```

The dev backend key is `campusops/dev/terraform.tfstate` and uses S3 native locking (`use_lockfile = true`), not the deprecated DynamoDB lock pattern.

Record the `state_bucket` and `github_deploy_role_arn` bootstrap outputs. Re-run bootstrap only through an authorized operator when the trust or deployment policy intentionally changes. This keeps the workflow role from changing its own permissions or OIDC provider.

## GitHub environment and OIDC

After the initial IAM bootstrap/apply, create the GitHub environment `dev`, add required reviewers, and set environment variables:

- `AWS_DEPLOY_ROLE_ARN`
- `AWS_REGION` (normally `us-west-2`)
- `TF_STATE_BUCKET`

The role trust subject is exactly `repo:gioadorno@85190258/campusops@1333443047:environment:dev`. The immutable owner and repository IDs prevent a renamed or transferred repository from inheriting this trust merely by taking the old name. No `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` is used. Run **Deploy dev** manually. It validates the application, creates the Lambda archive from a clean workspace build, assumes the OIDC role, plans/applies Terraform, reads table/Cognito/endpoint configuration from Terraform outputs, seeds fictional service statuses idempotently, and checks that the endpoint rejects an unauthenticated request.

For the first deployment, an authorized operator applies bootstrap first and then supplies its deployment-role output to the GitHub `dev` environment. The deployment role can create a tagged CampusOps Cognito user pool even though that create API cannot be scoped to a not-yet-existing ARN; all later Cognito operations are resource/tag constrained. If the AWS account already has the GitHub OIDC provider, import it into bootstrap state rather than creating a duplicate.

CampusOps pins the native HashiCorp AWS provider to `~> 6.12.0`. Version 6.12.0 is the minimum release with `aws_cognito_managed_login_branding`; the upgrade from 5.100.0 was reviewed against the v6 migration guide. The only listed change affecting a CampusOps resource type is the computed `aws_s3_bucket.region` rename to `bucket_region`, and CampusOps references neither field.

## Authenticated PKCE smoke test

Never place a password or token in source control. Create a fictional user interactively:

```bash
aws cognito-idp admin-create-user --user-pool-id <pool-id> --username dev.user@example.test
```

Terraform configures the user-pool domain for managed login version 2 and associates a Cognito-provided default branding style with the public PKCE app client; no custom visual assets are installed. Complete any temporary-password flow in that managed-login UI. Do not use a client secret: the app client is public and PKCE-based.

From the repository root, run the authenticated deployed smoke test with an AWS identity that can read the Terraform outputs and describe the Cognito app client:

```bash
AWS_PROFILE=campusops-terraform AWS_REGION=us-west-2 pnpm smoke:aws:auth
```

The command reads deployment coordinates from Terraform outputs, verifies the live authorization-code client, callback, identity provider, and CampusOps scopes, generates a fresh PKCE verifier/challenge and OAuth state, and starts a temporary listener at `http://localhost:3000/callback`. It opens Cognito managed login with `xdg-open` when available; otherwise it prints the authorization URL. Signing in through that browser window is the only human step. The callback code is captured and state-checked automatically, exchanged in process memory, and used to initialize MCP and confirm all six tools through the deployed endpoint. Codes, tokens, and the PKCE verifier are never printed or persisted.

`pnpm smoke:aws` remains available for controlled automation that already holds `MCP_URL` and `MCP_TOKEN`; interactive developer validation should prefer `smoke:aws:auth` to avoid copying token material.

PR CI never needs an AWS account or permanent test-user password.

## Phase 3A authenticated AI workspace

The local workspace BFF reuses the live Cognito client and MCP endpoint and invokes Bedrock with the operator's short-lived AWS profile. It creates no always-on infrastructure and uses on-demand model inference. The default model is `amazon.nova-lite-v1:0`; override `BEDROCK_MODEL_ID` with another configured Converse tool-use model when needed.

```bash
AWS_PROFILE=campusops-terraform AWS_REGION=us-west-2 pnpm dev:workspace
```

This command reads `cognito_user_pool_id`, `cognito_client_id`, `cognito_domain`, and `mcp_endpoint` from the dev Terraform state, then starts the workspace at `http://localhost:3000`. The existing Cognito client already includes `http://localhost:3000/callback` and the matching logout URL, so Phase 3A requires no Cognito replacement or Terraform change. Open the workspace, choose **Sign in with Cognito**, and complete managed login. The server creates PKCE/state material, captures the code, exchanges it without logging it, verifies both JWTs, clears the callback URL, and retains the access token only in the process-local server session.

Read requests can execute automatically after MCP authorization. Creating or cancelling a support request displays a human approval card; DynamoDB cannot change until **Approve** is selected. Approval sends only the random approval ID and CSRF token. The workspace executes the exact stored proposal once through MCP, and CampusOps still enforces scope, ownership, payload validation, durable idempotency, and audit.

The AWS identity used locally needs `bedrock:InvokeModel` for the configured model or inference profile. No AWS credentials are sent to browser JavaScript. Hosting the workspace, adding a dedicated runtime role, durable session/conversation storage, and Phase 3B RAG are future deployment work. Stopping the dev process clears sessions, conversations, access tokens, PKCE state, and pending approvals.

## Cleanup and cost

Development uses Lambda, HTTP API, Cognito, on-demand DynamoDB, S3 state, and CloudWatch. Destroy application resources explicitly; CI never destroys them:

```bash
cd infrastructure/environments/dev
terraform destroy
```

Retain the state bucket until all environment state is safely retired.

The OIDC provider, deployment role, and state bucket are not destroyed by the dev command because they belong to the separate bootstrap control plane.
