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

The role trust subject is exactly `repo:gioadorno/campusops:environment:dev`. No `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` is used. Run **Deploy dev** manually. It validates the application, creates the Lambda archive from a clean workspace build, assumes the OIDC role, plans/applies Terraform, reads table/Cognito/endpoint configuration from Terraform outputs, seeds fictional service statuses idempotently, and checks that the endpoint rejects an unauthenticated request.

For the first deployment, an authorized operator applies bootstrap first and then supplies its deployment-role output to the GitHub `dev` environment. The deployment role can create a tagged CampusOps Cognito user pool even though that create API cannot be scoped to a not-yet-existing ARN; all later Cognito operations are resource/tag constrained. If the AWS account already has the GitHub OIDC provider, import it into bootstrap state rather than creating a duplicate.

CampusOps pins the native HashiCorp AWS provider to `~> 6.12.0`. Version 6.12.0 is the minimum release with `aws_cognito_managed_login_branding`; the upgrade from 5.100.0 was reviewed against the v6 migration guide. The only listed change affecting a CampusOps resource type is the computed `aws_s3_bucket.region` rename to `bucket_region`, and CampusOps references neither field.

## Test user and PKCE token

Never place a password or token in source control. Create a fictional user interactively:

```bash
aws cognito-idp admin-create-user --user-pool-id <pool-id> --username dev.user@example.test
```

Terraform configures the user-pool domain for managed login version 2 and associates a Cognito-provided default branding style with the public PKCE app client; no custom visual assets are installed. Complete the temporary-password flow in that managed-login UI. Generate a PKCE verifier/challenge locally and open `https://<terraform-domain-output>.auth.<region>.amazoncognito.com/oauth2/authorize` with `response_type=code`, the Terraform client ID, an allow-listed `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, and scopes such as `openid campusops/policies.read campusops/services.read campusops/requests.read campusops/requests.write`. Exchange the returned code at `/oauth2/token` with the original verifier. Do not use a client secret: the app client is public and PKCE-based.

Then run the optional deployed smoke test:

```bash
MCP_URL='https://.../mcp' MCP_TOKEN='<access-token>' pnpm smoke:aws
```

PR CI never needs an AWS account or permanent test-user password.

## Cleanup and cost

Development uses Lambda, HTTP API, Cognito, on-demand DynamoDB, S3 state, and CloudWatch. Destroy application resources explicitly; CI never destroys them:

```bash
cd infrastructure/environments/dev
terraform destroy
```

Retain the state bucket until all environment state is safely retired.

The OIDC provider, deployment role, and state bucket are not destroyed by the dev command because they belong to the separate bootstrap control plane.
