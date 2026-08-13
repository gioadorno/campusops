output "mcp_endpoint" { value = module.api.endpoint }
output "cognito_user_pool_id" { value = module.cognito.user_pool_id }
output "cognito_client_id" { value = module.cognito.client_id }
output "operational_table_name" { value = module.operational.name }
output "audit_table_name" { value = module.audit.name }
