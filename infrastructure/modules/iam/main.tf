resource "aws_iam_role" "lambda" {
  name               = "${var.name}-runtime"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
  tags               = var.tags
}
resource "aws_iam_role_policy" "lambda" {
  role = aws_iam_role.lambda.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "OperationalTable", Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:TransactWriteItems"], Resource = [var.operational_table_arn, var.operational_index_arn] },
    { Sid = "AuditWrites", Effect = "Allow", Action = ["dynamodb:PutItem"], Resource = [var.audit_table_arn] },
    { Sid = "WriteKnownLogGroup", Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = ["${var.log_group_arn}:*"] }
  ] })
}
data "tls_certificate" "github" { url = "https://token.actions.githubusercontent.com" }
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github.certificates[0].sha1_fingerprint]
  tags            = var.tags
}
resource "aws_iam_role" "deploy" {
  name               = "${var.name}-github-deploy"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Federated = aws_iam_openid_connect_provider.github.arn }, Action = "sts:AssumeRoleWithWebIdentity", Condition = { StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com", "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:environment:dev" } } }] })
  tags               = var.tags
}
resource "aws_iam_role_policy" "deploy" {
  role = aws_iam_role.deploy.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "StateBucket", Effect = "Allow", Action = ["s3:ListBucket"], Resource = [var.state_bucket_arn] },
    { Sid = "StateObjects", Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource = ["${var.state_bucket_arn}/${var.state_key}", "${var.state_bucket_arn}/${var.state_key}.tflock"] },
    { Sid = "CampusOpsResources", Effect = "Allow", Action = ["lambda:CreateFunction", "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration", "lambda:GetFunction", "lambda:DeleteFunction", "lambda:AddPermission", "lambda:RemovePermission", "dynamodb:CreateTable", "dynamodb:UpdateTable", "dynamodb:DescribeTable", "dynamodb:DeleteTable", "dynamodb:UpdateTimeToLive", "dynamodb:DescribeTimeToLive", "cognito-idp:CreateUserPool", "cognito-idp:UpdateUserPool", "cognito-idp:DescribeUserPool", "cognito-idp:DeleteUserPool", "cognito-idp:CreateUserPoolClient", "cognito-idp:UpdateUserPoolClient", "cognito-idp:DescribeUserPoolClient", "cognito-idp:DeleteUserPoolClient", "cognito-idp:CreateResourceServer", "cognito-idp:UpdateResourceServer", "cognito-idp:DescribeResourceServer", "cognito-idp:DeleteResourceServer", "cognito-idp:CreateUserPoolDomain", "cognito-idp:DeleteUserPoolDomain", "apigateway:GET", "apigateway:POST", "apigateway:PATCH", "apigateway:DELETE", "logs:CreateLogGroup", "logs:PutRetentionPolicy", "logs:DeleteLogGroup", "cloudwatch:PutDashboard", "cloudwatch:DeleteDashboards", "cloudwatch:PutMetricAlarm", "cloudwatch:DeleteAlarms", "iam:GetRole", "iam:CreateRole", "iam:DeleteRole", "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:PassRole", "iam:CreateOpenIDConnectProvider", "iam:DeleteOpenIDConnectProvider", "iam:GetOpenIDConnectProvider", "iam:TagOpenIDConnectProvider"], Resource = ["arn:aws:lambda:${var.region}:${var.account_id}:function:${var.name}*", "arn:aws:dynamodb:${var.region}:${var.account_id}:table/${var.name}*", "arn:aws:cognito-idp:${var.region}:${var.account_id}:userpool/*", "arn:aws:apigateway:${var.region}::/apis*", "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${var.name}*", "arn:aws:cloudwatch::${var.account_id}:dashboard/${var.name}*", "arn:aws:cloudwatch:${var.region}:${var.account_id}:alarm:${var.name}*", "arn:aws:iam::${var.account_id}:role/${var.name}*", "arn:aws:iam::${var.account_id}:oidc-provider/token.actions.githubusercontent.com"] }
  ] })
}
output "lambda_role_arn" { value = aws_iam_role.lambda.arn }
output "deploy_role_arn" { value = aws_iam_role.deploy.arn }
