variable "name" { type = string }
variable "lambda_arn" { type = string }
variable "lambda_invoke_arn" { type = string }
variable "cognito_issuer" { type = string }
variable "cognito_client_id" { type = string }
variable "allowed_origins" { type = list(string) }
variable "tags" { type = map(string) }
