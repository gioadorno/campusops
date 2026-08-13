resource "aws_cognito_user_pool" "this" {
  name                     = var.name
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  password_policy {
    minimum_length                   = 14
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 1
  }
  tags = var.tags
}
resource "aws_cognito_resource_server" "campusops" {
  identifier   = "campusops"
  name         = "CampusOps MCP"
  user_pool_id = aws_cognito_user_pool.this.id
  dynamic "scope" {
    for_each = { "policies.read" = "Read policies", "services.read" = "Read service status", "requests.read" = "Read owned support requests", "requests.write" = "Create and cancel owned support requests", "admin.audit" = "Administer audit events" }
    content {
      scope_name        = scope.key
      scope_description = scope.value
    }
  }
}
resource "aws_cognito_user_pool_client" "pkce" {
  name                                 = "${var.name}-pkce"
  user_pool_id                         = aws_cognito_user_pool.this.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = concat(["openid", "email"], [for scope in aws_cognito_resource_server.campusops.scope_identifiers : scope])
  callback_urls                        = var.callback_urls
  logout_urls                          = var.logout_urls
  supported_identity_providers         = ["COGNITO"]
  prevent_user_existence_errors        = "ENABLED"
  access_token_validity                = 60
  token_validity_units { access_token = "minutes" }
}
resource "aws_cognito_user_pool_domain" "this" {
  domain                = var.name
  user_pool_id          = aws_cognito_user_pool.this.id
  managed_login_version = 2
}
resource "aws_cognito_managed_login_branding" "pkce" {
  user_pool_id                = aws_cognito_user_pool.this.id
  client_id                   = aws_cognito_user_pool_client.pkce.id
  use_cognito_provided_values = true
  depends_on                  = [aws_cognito_user_pool_domain.this]
}
output "user_pool_id" { value = aws_cognito_user_pool.this.id }
output "client_id" { value = aws_cognito_user_pool_client.pkce.id }
output "issuer" { value = "https://cognito-idp.${data.aws_region.current.region}.amazonaws.com/${aws_cognito_user_pool.this.id}" }
output "domain" { value = aws_cognito_user_pool_domain.this.domain }
output "scope_identifiers" { value = aws_cognito_resource_server.campusops.scope_identifiers }
data "aws_region" "current" {}
