locals {
  www_domain = "www.${var.domain_name}"
  origin_id  = "${var.name_prefix}-s3-origin"
  github_sub = "repo:${var.github_repository}:ref:refs/heads/${var.github_branch}"
}
