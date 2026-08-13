output "mcp_endpoint" { value = module.api.endpoint }
output "cognito_user_pool_id" { value = module.cognito.user_pool_id }
output "cognito_client_id" { value = module.cognito.client_id }
output "github_deploy_role_arn" { value = module.iam.deploy_role_arn }
