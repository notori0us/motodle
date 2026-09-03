locals {
  www_domain = "www.${var.domain_name}"
  origin_id  = "${var.name_prefix}-s3-origin"
  github_sub = "repo:${var.github_repository}:ref:refs/heads/${var.github_branch}"
  # Immutable-subject form: repo:OWNER@OWNER_ID/REPO@REPO_ID:ref:refs/heads/BRANCH
  github_sub_immutable = "repo:${split("/", var.github_repository)[0]}@${var.github_owner_id}/${split("/", var.github_repository)[1]}@${var.github_repository_id}:ref:refs/heads/${var.github_branch}"
  github_subs          = [local.github_sub, local.github_sub_immutable]
}
