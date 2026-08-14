variable "aws_region" {
  type    = string
  default = "us-west-2"
}
variable "state_bucket_name" { type = string }
variable "github_owner" {
  type    = string
  default = "gioadorno"
}

variable "github_owner_id" {
  type    = string
  default = "85190258"
}

variable "github_repository_name" {
  type    = string
  default = "campusops"
}

variable "github_repository_id" {
  type    = string
  default = "1333443047"
}
variable "environment" {
  type    = string
  default = "dev"
}
