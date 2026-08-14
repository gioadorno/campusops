resource "aws_s3_bucket" "state" {
  bucket = var.state_bucket_name
  tags   = local.tags
}
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
    bucket_key_enabled = true
  }
}
resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_caller_identity" "current" {}
data "tls_certificate" "github" { url = "https://token.actions.githubusercontent.com" }

locals {
  application_name = "campusops-${var.environment}"
  state_key        = "campusops/${var.environment}/terraform.tfstate"
  tags             = { Project = "CampusOps", Environment = var.environment, ManagedBy = "Terraform" }
  account_id       = data.aws_caller_identity.current.account_id
  runtime_role_arn = "arn:aws:iam::${local.account_id}:role/${local.application_name}-runtime"
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github.certificates[0].sha1_fingerprint]
  tags            = local.tags
}

resource "aws_iam_role" "github_deploy" {
  name = "${local.application_name}-github-deploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_owner}@${var.github_owner_id}/${var.github_repository_name}@${var.github_repository_id}:environment:${var.environment}"
        }
      }
    }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy" "github_deploy" {
  role = aws_iam_role.github_deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "StateBucket"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [aws_s3_bucket.state.arn]
      },
      {
        Sid      = "StateObjects"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = ["${aws_s3_bucket.state.arn}/${local.state_key}", "${aws_s3_bucket.state.arn}/${local.state_key}.tflock"]
      },
      {
        # CreateUserPool has no resource ARN until the API succeeds, so request tags
        # are the least-privilege boundary supported by Cognito for this action.
        Sid      = "CreateTaggedCampusOpsUserPool"
        Effect   = "Allow"
        Action   = ["cognito-idp:CreateUserPool"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "aws:RequestTag/Project"     = "CampusOps"
            "aws:RequestTag/Environment" = var.environment
          }
        }
      },
      {
        Sid    = "ManageTaggedCampusOpsCognito"
        Effect = "Allow"
        Action = [
          "cognito-idp:UpdateUserPool", "cognito-idp:DescribeUserPool", "cognito-idp:GetUserPoolMfaConfig", "cognito-idp:DeleteUserPool",
          "cognito-idp:CreateUserPoolClient", "cognito-idp:UpdateUserPoolClient", "cognito-idp:DescribeUserPoolClient", "cognito-idp:DeleteUserPoolClient",
          "cognito-idp:CreateResourceServer", "cognito-idp:UpdateResourceServer", "cognito-idp:DescribeResourceServer", "cognito-idp:DeleteResourceServer",
          "cognito-idp:CreateUserPoolDomain", "cognito-idp:UpdateUserPoolDomain", "cognito-idp:DeleteUserPoolDomain",
          "cognito-idp:CreateManagedLoginBranding", "cognito-idp:DescribeManagedLoginBranding", "cognito-idp:DescribeManagedLoginBrandingByClient", "cognito-idp:UpdateManagedLoginBranding", "cognito-idp:DeleteManagedLoginBranding", "cognito-idp:ListUserPoolClients",
          "cognito-idp:TagResource", "cognito-idp:UntagResource", "cognito-idp:ListTagsForResource"
        ]
        Resource = ["arn:aws:cognito-idp:${var.aws_region}:${local.account_id}:userpool/*"]
        Condition = {
          StringEquals = {
            "aws:ResourceTag/Project"     = "CampusOps"
            "aws:ResourceTag/Environment" = var.environment
          }
        }
      },
      {
        Sid      = "ReadCognitoUserPoolDomain"
        Effect   = "Allow"
        Action   = ["cognito-idp:DescribeUserPoolDomain"]
        Resource = "*"
      },
      {
        Sid      = "ManageCampusOpsLambda"
        Effect   = "Allow"
        Action   = ["lambda:CreateFunction", "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration", "lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:GetFunctionConcurrency", "lambda:GetFunctionCodeSigningConfig", "lambda:GetPolicy", "lambda:DeleteFunction", "lambda:AddPermission", "lambda:RemovePermission", "lambda:TagResource", "lambda:UntagResource", "lambda:ListTags", "lambda:ListVersionsByFunction"]
        Resource = ["arn:aws:lambda:${var.aws_region}:${local.account_id}:function:${local.application_name}*"]
      },
      {
        Sid      = "ManageCampusOpsDynamoDb"
        Effect   = "Allow"
        Action   = ["dynamodb:CreateTable", "dynamodb:UpdateTable", "dynamodb:DescribeTable", "dynamodb:DeleteTable", "dynamodb:UpdateTimeToLive", "dynamodb:DescribeTimeToLive", "dynamodb:UpdateContinuousBackups", "dynamodb:DescribeContinuousBackups", "dynamodb:TagResource", "dynamodb:UntagResource", "dynamodb:ListTagsOfResource"]
        Resource = ["arn:aws:dynamodb:${var.aws_region}:${local.account_id}:table/${local.application_name}-*"]
      },
      {
        Sid    = "ManageCampusOpsApiGateway"
        Effect = "Allow"
        Action = ["apigateway:*"]

        Resource = [
          "arn:aws:apigateway:${var.aws_region}::/apis*",
          "arn:aws:apigateway:${var.aws_region}::/tags/*"
        ]
      },
      {
        Sid    = "SeedCampusOpsOperationalData"
        Effect = "Allow"

        Action = [
          "dynamodb:PutItem"
        ]

        Resource = [
          "arn:aws:dynamodb:${var.aws_region}:${local.account_id}:table/${local.application_name}-operational"
        ]
      },
      {
        Sid      = "ManageCampusOpsLogGroup"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:PutRetentionPolicy", "logs:DeleteLogGroup", "logs:TagResource", "logs:UntagResource", "logs:ListTagsForResource"]
        Resource = ["arn:aws:logs:${var.aws_region}:${local.account_id}:log-group:/aws/lambda/${local.application_name}*"]
      },
      {
        Sid      = "ManageCampusOpsDashboard"
        Effect   = "Allow"
        Action   = ["cloudwatch:PutDashboard", "cloudwatch:GetDashboard", "cloudwatch:DeleteDashboards", "cloudwatch:TagResource", "cloudwatch:UntagResource", "cloudwatch:ListTagsForResource"]
        Resource = ["arn:aws:cloudwatch::${local.account_id}:dashboard/${local.application_name}*"]
      },
      {
        Sid      = "ManageCampusOpsAlarms"
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricAlarm", "cloudwatch:DeleteAlarms", "cloudwatch:DescribeAlarms", "cloudwatch:TagResource", "cloudwatch:UntagResource", "cloudwatch:ListTagsForResource"]
        Resource = ["arn:aws:cloudwatch:${var.aws_region}:${local.account_id}:alarm:${local.application_name}*"]
      },
      {
        Sid      = "ReadCloudWatchLogGroups"
        Effect   = "Allow"
        Action   = ["logs:DescribeLogGroups"]
        Resource = "*"
      },
      {
        Sid      = "ManageLambdaRuntimeRoleOnly"
        Effect   = "Allow"
        Action   = ["iam:GetRole", "iam:CreateRole", "iam:DeleteRole", "iam:UpdateAssumeRolePolicy", "iam:UpdateRole", "iam:UpdateRoleDescription", "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:GetRolePolicy", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:ListInstanceProfilesForRole", "iam:TagRole", "iam:UntagRole", "iam:ListRoleTags"]
        Resource = [local.runtime_role_arn]
      },
      {
        Sid      = "PassLambdaRuntimeRoleOnly"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = [local.runtime_role_arn]
        Condition = {
          StringEquals = { "iam:PassedToService" = "lambda.amazonaws.com" }
        }
      }
    ]
  })
}

output "state_bucket" { value = aws_s3_bucket.state.id }
output "github_deploy_role_arn" { value = aws_iam_role.github_deploy.arn }
