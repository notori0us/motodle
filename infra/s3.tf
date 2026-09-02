resource "aws_s3_bucket" "site" {
  bucket = "${var.name_prefix}-site-${data.aws_caller_identity.current.account_id}"

  # §13.8: no S3 versioning here (git is the true source of truth; every deploy is --delete), so a
  # non-empty bucket is never the only copy of anything. force_destroy lets `terraform destroy`
  # (the realistic teardown path) work without a manual `aws s3 rm --recursive` first.
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# OAC requires ACLs to be disabled on the bucket.
resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

data "aws_iam_policy_document" "site_bucket" {
  statement {
    sid     = "AllowCloudFrontServicePrincipalReadOnly"
    effect  = "Allow"
    actions = ["s3:GetObject"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    resources = ["${aws_s3_bucket.site.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }

  # Load-bearing: without s3:ListBucket, S3 answers 403 for a missing key and
  # the game shows "couldn't load" instead of "no puzzle today" (PLAN 5.1).
  statement {
    sid     = "AllowCloudFrontListBucketSoMissingKeysAre404"
    effect  = "Allow"
    actions = ["s3:ListBucket"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    resources = [aws_s3_bucket.site.arn]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.site]
}
