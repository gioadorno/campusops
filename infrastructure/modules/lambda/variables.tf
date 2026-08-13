variable "name" { type = string }
variable "role_arn" { type = string }
variable "artifact_path" { type = string }
variable "environment" { type = map(string) }
variable "log_retention_days" {
  type    = number
  default = 30
}
variable "tags" { type = map(string) }
