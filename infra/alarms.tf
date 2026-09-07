# infra/alarms.tf — CloudFront error visibility (LAUNCH.md B7c). CloudFront publishes its free
# metrics into us-east-1, and an alarm's action must target a topic in the alarm's own region, so
# everything here carries provider = aws.us_east_1.

resource "aws_sns_topic" "alerts" {
  provider = aws.us_east_1
  name     = "${var.name_prefix}-alerts"
}

# Email subscriptions need a click in the confirmation mail; an apply leaves this
# "pending confirmation" until the operator confirms. Expected, not a failed apply.
resource "aws_sns_topic_subscription" "alerts_email" {
  count     = var.alert_email == null ? 0 : 1
  provider  = aws.us_east_1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# 5xx is unambiguous: any sustained origin failure is real.
resource "aws_cloudwatch_metric_alarm" "cf_5xx" {
  provider            = aws.us_east_1
  alarm_name          = "${var.name_prefix}-cloudfront-5xx"
  namespace           = "AWS/CloudFront"
  metric_name         = "5xxErrorRate"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { DistributionId = aws_cloudfront_distribution.site.id, Region = "Global" }
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

# 4xx is catastrophic-only: OAC loss turns every non-redirect request into a 404 (~87 % of an
# hour's requests in the median hour). It cannot see runway exhaustion (one 404 in ~5 requests):
# bots are 30-60 % of hourly requests by count, and the hourly Average is count-weighted, so the
# original 25 % paged on scanner noise (2026-09-06). Threshold 60 for 3 h had zero trips over two
# days of logs (longest bot breach 1 h). Floor 20 stays: 11 of 48 hours had under 50 requests,
# so a higher floor only delays detection.
resource "aws_cloudwatch_metric_alarm" "cf_4xx" {
  provider            = aws.us_east_1
  alarm_name          = "${var.name_prefix}-cloudfront-4xx"
  evaluation_periods  = 3 # 3 hours of sustained breach before it pages
  threshold           = 60
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  metric_query {
    id          = "gated"
    expression  = "IF(reqs >= 20, rate4xx, 0)"
    label       = "4xxErrorRate when traffic is meaningful"
    return_data = true
  }
  metric_query {
    id = "rate4xx"
    metric {
      namespace   = "AWS/CloudFront"
      metric_name = "4xxErrorRate"
      stat        = "Average"
      period      = 3600
      dimensions  = { DistributionId = aws_cloudfront_distribution.site.id, Region = "Global" }
    }
  }
  metric_query {
    id = "reqs"
    metric {
      namespace   = "AWS/CloudFront"
      metric_name = "Requests"
      stat        = "Sum"
      period      = 3600
      dimensions  = { DistributionId = aws_cloudfront_distribution.site.id, Region = "Global" }
    }
  }
}
