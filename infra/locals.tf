locals {
  www_domain = "www.${var.domain_name}"
  origin_id  = "${var.name_prefix}-s3-origin"
  repo_name  = split("/", var.github_repository)[1]
  github_sub = "repo:${var.github_repository}:ref:refs/heads/${var.github_branch}"
  # Immutable-subject form: repo:OWNER@OWNER_ID/REPO@REPO_ID:ref:refs/heads/BRANCH
  github_sub_immutable = "repo:${split("/", var.github_repository)[0]}@${var.github_owner_id}/${local.repo_name}@${var.github_repository_id}:ref:refs/heads/${var.github_branch}"
  # During an ownership transfer the repo id is stable but the owner (and owner id) change.
  github_transfer_subs = var.github_transfer_to == null ? [] : [
    "repo:${var.github_transfer_to.owner}/${local.repo_name}:ref:refs/heads/${var.github_branch}",
    "repo:${var.github_transfer_to.owner}@${var.github_transfer_to.owner_id}/${local.repo_name}@${var.github_repository_id}:ref:refs/heads/${var.github_branch}",
  ]
  github_subs = concat([local.github_sub, local.github_sub_immutable], local.github_transfer_subs)
}
