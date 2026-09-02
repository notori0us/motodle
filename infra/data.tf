# used for getting current account ID
data "aws_caller_identity" "current" {}

# The hosted zone already exists and is empty; Terraform owns the records in it.
data "aws_route53_zone" "this" {
  name         = "${var.domain_name}."
  private_zone = false
}

# Created by terraform-core. Referenced, never managed here.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}
