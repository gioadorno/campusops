# Development Deployment

## Bootstrap remote state

Bootstrap uses local state once. Choose a globally unique bucket name:

```bash
cd infrastructure/bootstrap
terraform init
terraform apply -var='state_bucket_name=<unique-campusops-state-bucket>'
```

The dev backend key is `campusops/dev/terraform.tfstate` and uses S3 native locking (`use_lockfile = true`), not the deprecated DynamoDB lock pattern.

## GitHub environment and OIDC

After the initial IAM bootstrap/apply, create the GitHub environment `dev`, add required reviewers, and set environment variables:

- `AWS_DEPLOY_ROLE_ARN`
- `AWS_REGION` (normally `us-west-2`)
- `TF_STATE_BUCKET`

The role trust subject is exactly `repo:gioadorno/campusops:environment:dev`. No `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` is used. Run **Deploy dev** manually. It validates the application, builds `dist/aws/campusops-mcp.zip`, assumes the OIDC role, plans/applies Terraform, seeds fictional service statuses idempotently, and checks that the endpoint rejects an unauthenticated request.

For a first deployment where Terraform must create its own OIDC role, an authorized operator applies locally once; subsequent workflow runs use that role. If the AWS account already has the GitHub OIDC provider, import it rather than creating a duplicate.

## Test user and PKCE token

Never place a password or token in source control. Create a fictional user interactively:

```bash
aws cognito-idp admin-create-user --user-pool-id <pool-id> --username dev.user@example.test
```

Complete the temporary-password flow in the Cognito hosted UI. Generate a PKCE verifier/challenge locally and open the hosted authorization endpoint with `response_type=code`, the Terraform client ID, an allow-listed redirect URI, and scopes such as `openid campusops/policies.read campusops/services.read campusops/requests.read campusops/requests.write`. Exchange the returned code at `/oauth2/token` with the verifier. Do not use a client secret: the app client is public and PKCE-based.

Then run the optional deployed smoke test:

```bash
MCP_URL='https://.../mcp' MCP_TOKEN='<access-token>' pnpm smoke:aws
```

PR CI never needs an AWS account or permanent test-user password.

## Cleanup and cost

Development uses Lambda, HTTP API, Cognito, on-demand DynamoDB, S3 state, and CloudWatch. Destroy application resources explicitly; CI never destroys them:

```bash
cd infrastructure/environments/dev
terraform destroy -var='state_bucket_name=<bucket>'
```

Retain the state bucket until all environment state is safely retired.
