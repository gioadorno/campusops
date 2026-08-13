variable "aws_region" {
  type    = string
  default = "us-west-2"
}
variable "state_bucket_name" { type = string }
variable "github_repository" {
  type    = string
  default = "gioadorno/campusops"
}
variable "environment" {
  type    = string
  default = "dev"
}
