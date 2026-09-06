# infra/logs.tf — CloudFront standard access logs v2 -> S3, for launch measurement (PLAN §13.8 revisit).
# Design and field-by-field rationale: docs/LAUNCH.md A.3. Operator decisions 2026-09-04: logs only
# (no beacon), c-ip and x-forwarded-for omitted.

resource "aws_s3_bucket" "logs" {
  bucket        = "${var.name_prefix}-logs-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "logs" {
  bucket                  = aws_s3_bucket.logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# v2 delivery works with BucketOwnerEnforced -- the x-amz-acl condition below is satisfiable there.
# This is the discriminator against legacy logging, which requires ACLs to be ENABLED.
resource "aws_s3_bucket_ownership_controls" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# SSE-S3, NOT SSE-KMS with an AWS managed key -- vended log delivery cannot write to the latter.
resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Retention IS the privacy lever. 90 days is long enough to compare launch week to a steady state.
resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    id     = "expire-access-logs"
    status = "Enabled"
    filter {}
    expiration {
      days = 90
    }
  }
}

data "aws_iam_policy_document" "logs_bucket" {
  statement {
    sid     = "AWSLogDeliveryWrite"
    effect  = "Allow"
    actions = ["s3:PutObject"]
    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }
    resources = ["${aws_s3_bucket.logs.arn}/AWSLogs/${data.aws_caller_identity.current.account_id}/*"]
    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:logs:us-east-1:${data.aws_caller_identity.current.account_id}:delivery-source:*"]
    }
  }

  # REQUIRED, and easy to omit: AWS's V2 log-delivery page states you must grant s3:ListBucket to
  # delivery.logs.amazonaws.com and must include the Condition parameters shown with s3:GetBucketAcl.
  # Without this statement the delivery fails its pre-flight bucket check, not its PutObject.
  statement {
    sid     = "AWSLogDeliveryAclCheck"
    effect  = "Allow"
    actions = ["s3:GetBucketAcl", "s3:ListBucket"]
    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }
    resources = [aws_s3_bucket.logs.arn]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:logs:us-east-1:${data.aws_caller_identity.current.account_id}:delivery-source:*"]
    }
  }
}

resource "aws_s3_bucket_policy" "logs" {
  bucket = aws_s3_bucket.logs.id
  policy = data.aws_iam_policy_document.logs_bucket.json

  # Mirrors aws_s3_bucket_policy.site -- the public access block must exist before the policy, or
  # the policy put can race it.
  depends_on = [aws_s3_bucket_public_access_block.logs]
}

# The CloudWatch delivery API for CloudFront is us-east-1 only: all three resources below carry
# provider = aws.us_east_1. (v6 adds a per-resource `region` argument; the alias is kept as-is.)
resource "aws_cloudwatch_log_delivery_source" "cf" {
  provider     = aws.us_east_1
  name         = "${var.name_prefix}-cf-access-logs"
  log_type     = "ACCESS_LOGS"
  resource_arn = aws_cloudfront_distribution.site.arn
}

resource "aws_cloudwatch_log_delivery_destination" "cf_s3" {
  provider = aws.us_east_1
  name     = "${var.name_prefix}-cf-logs-s3"
  # IMMUTABLE after create: changing output_format requires deleting and recreating the delivery.
  # "json" is chosen so the Athena DDL survives any later record_fields edit (OpenX JsonSerDe
  # returns NULL for absent keys; w3c/plain are positional and would break).
  # NEVER "parquet" -- it is the one format AWS documents as incurring CloudWatch charges.
  output_format = "json"

  delivery_destination_configuration {
    destination_resource_arn = aws_s3_bucket.logs.arn
  }
}

resource "aws_cloudwatch_log_delivery" "cf_to_s3" {
  provider                 = aws.us_east_1
  delivery_source_name     = aws_cloudwatch_log_delivery_source.cf.name
  delivery_destination_arn = aws_cloudwatch_log_delivery_destination.cf_s3.arn

  # Nothing in the arguments references the bucket POLICY, so without this Terraform may create
  # the delivery before the policy exists and the first apply fails on access to the bucket.
  depends_on = [aws_s3_bucket_policy.logs]

  # c-ip and x-forwarded-for are DELIBERATELY ABSENT (operator decision D2, 2026-09-04). Adding
  # either turns this log into GDPR personal-data processing; omitting them costs only the IP+UA
  # "unique visitor" approximation, which is wrong in both directions anyway.
  # x-edge-location is ALSO deliberately absent: nothing in LAUNCH.md Q1-Q7 reads it, and alongside
  # cs(User-Agent), c-country and second-resolution timestamps it is one more quasi-identifier
  # bought for no analytical gain.
  record_fields = [
    "date", "time", "sc-bytes", "cs-method", "cs(Host)", "cs-uri-stem",
    "sc-status", "cs(Referer)", "cs(User-Agent)", "cs-uri-query", "x-edge-result-type",
    "x-host-header", "cs-protocol", "cs-bytes", "time-taken", "cs-protocol-version",
    "x-edge-detailed-result-type", "sc-content-type", "c-country",
  ]

  s3_delivery_configuration {
    enable_hive_compatible_path = false
    # AWS prepends AWSLogs/<account>/CloudFront/ itself -- supply ONLY the suffix.
    suffix_path = "{DistributionId}/{yyyy}/{MM}/{dd}/{HH}"
  }

  # Provider 5.100.0 had two defects here (spurious "Provided delivery configuration is invalid
  # for the destination type" on an unchanged block; suffix_path losing the AWS-added prefix on
  # update), fixed in the v6 line (6.32.1 / 6.52.0). ignore_changes stays until a post-bump plan
  # proves the block clean.
  lifecycle {
    ignore_changes = [s3_delivery_configuration]
  }
}
