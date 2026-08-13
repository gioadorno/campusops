locals {
  name = "campusops-dev"
  tags = { Project = "CampusOps", Environment = "dev", ManagedBy = "Terraform" }
}
module "operational" {
  source = "../../modules/dynamodb"
  name   = "${local.name}-operational"
  tags   = local.tags
}
module "audit" {
  source = "../../modules/audit"
  name   = "${local.name}-audit"
  tags   = local.tags
}
module "cognito" {
  source        = "../../modules/cognito"
  name          = "${local.name}-${data.aws_caller_identity.current.account_id}"
  callback_urls = var.callback_urls
  logout_urls   = var.logout_urls
  tags          = local.tags
}

module "iam" {
  source                = "../../modules/iam"
  name                  = local.name
  operational_table_arn = module.operational.arn
  operational_index_arn = module.operational.index_arn
  audit_table_arn       = module.audit.arn
  log_group_arn         = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${local.name}-mcp"
  github_repository     = var.github_repository
  state_bucket_arn      = "arn:aws:s3:::${var.state_bucket_name}"
  state_key             = "campusops/dev/terraform.tfstate"
  region                = var.aws_region
  account_id            = data.aws_caller_identity.current.account_id
  tags                  = local.tags
}
module "lambda" {
  source        = "../../modules/lambda"
  name          = "${local.name}-mcp"
  role_arn      = module.iam.lambda_role_arn
  artifact_path = var.lambda_artifact_path
  environment = {
    CAMPUSOPS_RUNTIME          = "aws"
    AWS_REGION                 = var.aws_region
    CAMPUSOPS_TABLE_NAME       = module.operational.name
    CAMPUSOPS_AUDIT_TABLE_NAME = module.audit.name
    COGNITO_USER_POOL_ID       = module.cognito.user_pool_id
    COGNITO_CLIENT_ID          = module.cognito.client_id
    ALLOWED_ORIGINS            = join(",", var.allowed_origins)
    ENVIRONMENT                = "dev"
  }
  tags = local.tags
}
module "api" {
  source            = "../../modules/api-gateway"
  name              = "${local.name}-mcp"
  lambda_arn        = module.lambda.arn
  lambda_invoke_arn = module.lambda.invoke_arn
  cognito_issuer    = module.cognito.issuer
  cognito_client_id = module.cognito.client_id
  allowed_origins   = var.allowed_origins
  tags              = local.tags
}
module "observability" {
  source                 = "../../modules/observability"
  name                   = local.name
  lambda_name            = module.lambda.name
  api_id                 = module.api.api_id
  operational_table_name = module.operational.name
  audit_table_name       = module.audit.name
  tags                   = local.tags
}
