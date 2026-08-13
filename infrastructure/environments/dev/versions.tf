terraform {
  required_version = ">= 1.10.0"
  backend "s3" {
    key          = "campusops/dev/terraform.tfstate"
    use_lockfile = true
    encrypt      = true
  }
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.80" }
    tls = { source = "hashicorp/tls", version = "~> 4.0" }
  }
}
provider "aws" {
  region = var.aws_region
  default_tags { tags = local.tags }
}
data "aws_caller_identity" "current" {}
