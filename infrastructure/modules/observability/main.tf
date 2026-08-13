resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = var.name
  dashboard_body = jsonencode({ widgets = [{
    type = "metric", x = 0, y = 0, width = 24, height = 12,
    properties = {
      title = "CampusOps Phase 2", view = "timeSeries", region = data.aws_region.current.region,
      metrics = [
        ["AWS/Lambda", "Invocations", "FunctionName", var.lambda_name],
        [".", "Errors", ".", "."], [".", "Duration", ".", "."],
        ["AWS/ApiGateway", "Count", "ApiId", var.api_id],
        [".", "4xx", ".", "."], [".", "5xx", ".", "."],
        ["AWS/DynamoDB", "ThrottledRequests", "TableName", var.operational_table_name],
        [".", ".", ".", var.audit_table_name]
      ]
    }
  }] })
}
resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name          = "${var.name}-lambda-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = var.lambda_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  tags                = var.tags
}
resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${var.name}-api-5xx"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  dimensions          = { ApiId = var.api_id }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  tags                = var.tags
}
resource "aws_cloudwatch_metric_alarm" "throttles" {
  for_each            = toset([var.operational_table_name, var.audit_table_name])
  alarm_name          = "${var.name}-${each.value}-throttles"
  namespace           = "AWS/DynamoDB"
  metric_name         = "ThrottledRequests"
  dimensions          = { TableName = each.value }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  tags                = var.tags
}
data "aws_region" "current" {}
