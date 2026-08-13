resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${var.name}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}
resource "aws_lambda_function" "this" {
  function_name    = var.name
  role             = var.role_arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  filename         = var.artifact_path
  source_code_hash = filebase64sha256(var.artifact_path)
  memory_size      = 512
  timeout          = 29
  environment { variables = var.environment }
  depends_on = [aws_cloudwatch_log_group.this]
  tags       = var.tags
}
output "arn" { value = aws_lambda_function.this.arn }
output "invoke_arn" { value = aws_lambda_function.this.invoke_arn }
output "name" { value = aws_lambda_function.this.function_name }
output "log_group_arn" { value = aws_cloudwatch_log_group.this.arn }
