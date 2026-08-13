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
output "lambda_role_arn" { value = aws_iam_role.lambda.arn }
