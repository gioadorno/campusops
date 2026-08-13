# ADR 010: Terraform remote state

- Status: Accepted
- Date: 2026-08-13

Bootstrap a private, encrypted, versioned S3 bucket using local state once. Dev uses key `campusops/dev/terraform.tfstate` and S3 native `use_lockfile = true`. Do not create a DynamoDB lock table because that backend locking mechanism is deprecated.
