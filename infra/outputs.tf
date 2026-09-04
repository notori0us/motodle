output "site_bucket" {
  description = "S3 bucket holding the built site."
  value       = aws_s3_bucket.site.bucket
}

output "distribution_id" {
  description = "CloudFront distribution id (GitHub variable CLOUDFRONT_DISTRIBUTION_ID)."
  value       = aws_cloudfront_distribution.site.id
}

output "distribution_domain_name" {
  description = "CloudFront domain name, for debugging before DNS propagates."
  value       = aws_cloudfront_distribution.site.domain_name
}

output "deploy_role_arn" {
  description = "Role GitHub Actions assumes (GitHub variable AWS_DEPLOY_ROLE_ARN)."
  value       = aws_iam_role.deploy.arn
}

output "gh_variable_commands" {
  description = "Paste these into a shell at the repo root after apply."
  value = join("\n", [
    "gh variable set AWS_DEPLOY_ROLE_ARN --body '${aws_iam_role.deploy.arn}'",
    "gh variable set SITE_BUCKET --body '${aws_s3_bucket.site.bucket}'",
    "gh variable set CLOUDFRONT_DISTRIBUTION_ID --body '${aws_cloudfront_distribution.site.id}'",
  ])
}

output "logs_bucket" {
  description = "S3 bucket receiving CloudFront standard access logs v2 (LAUNCH.md A.3/A.6)."
  value       = aws_s3_bucket.logs.bucket
}
