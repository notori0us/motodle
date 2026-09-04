# Account-wide cost guardrail (LAUNCH.md B8). Deliberately NOT service-filtered: the point is to
# catch a surprise, and a filter would exclude the surprise by construction. OWNED BY THIS
# WORKSPACE -- do not add a second account budget in terraform-core.
#
# Budgets email directly (no SNS topic), so this costs $0. Expect the FORECASTED mail during a
# launch that is working: AWS projects month-to-date spend, so one big day early in the month
# forecasts past the cap. Treat that one as informational.
resource "aws_budgets_budget" "account_monthly" {
  name              = "${var.name_prefix}-account-monthly"
  budget_type       = "COST"
  limit_amount      = "10"
  limit_unit        = "USD"
  time_unit         = "MONTHLY"
  time_period_start = "2026-09-01_00:00"

  # ~$2: four times today's ~$0.50 baseline is worth knowing about early.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 20
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
  # ~$6: the "this is really happening" line.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 60
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
  # Forecast to blow the $10 cap. Needs some billing history before AWS will forecast at all.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}
