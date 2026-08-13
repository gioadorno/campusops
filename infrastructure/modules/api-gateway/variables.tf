variable "name" { type = string }
variable "lambda_arn" { type = string }
variable "lambda_invoke_arn" { type = string }
variable "cognito_issuer" { type = string }
variable "cognito_client_id" { type = string }
variable "authorization_scopes" {
  type = list(string)
  validation {
    condition = (
      length(var.authorization_scopes) > 0 &&
      alltrue([for scope in var.authorization_scopes : startswith(scope, "campusops/")])
    )
    error_message = "At least one campusops/ OAuth scope is required."
  }
}
variable "allowed_origins" { type = list(string) }
variable "tags" { type = map(string) }
