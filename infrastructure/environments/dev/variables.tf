variable "aws_region" {
  type    = string
  default = "us-west-2"
}
variable "allowed_origins" {
  type    = list(string)
  default = ["http://localhost:3000"]
}
variable "callback_urls" {
  type    = list(string)
  default = ["http://localhost:3000/callback"]
}
variable "logout_urls" {
  type    = list(string)
  default = ["http://localhost:3000"]
}
variable "lambda_artifact_path" {
  type    = string
  default = "../../../dist/aws/campusops-mcp.zip"
}
