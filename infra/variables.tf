variable "aws_region" {
  description = "Region for the site bucket and all non-CloudFront resources."
  type        = string
  default     = "us-west-2"
}

variable "domain_name" {
  description = "Apex domain; the canonical origin for the site."
  type        = string
  default     = "playmotodle.com"
}

variable "github_repository" {
  description = "owner/repo allowed to assume the deploy role."
  type        = string
  default     = "reenchree/motodle"
}

variable "github_branch" {
  description = "Branch ref allowed to assume the deploy role."
  type        = string
  default     = "main"
}

variable "name_prefix" {
  description = "Prefix for every named resource."
  type        = string
  default     = "motodle"
}

variable "content_security_policy" {
  description = "CSP served on every response. Verified against the built app."
  type        = string
  default     = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'"
}

# GitHub now issues OIDC subjects in an "immutable" form that embeds numeric ids
# (repo:OWNER@OWNER_ID/REPO@REPO_ID:ref:...). The trust policy accepts both forms.
# Find them with: gh api repos/reenchree/motodle --jq '.owner.id, .id'
variable "github_owner_id" {
  description = "Numeric id of the GitHub owner (org/user) for the immutable OIDC subject."
  type        = number
  default     = 213154582
}

variable "github_repository_id" {
  description = "Numeric id of the GitHub repository for the immutable OIDC subject."
  type        = number
  default     = 1355164768
}

# Ownership transfer in flight (reenchree -> notori0us, 2026-09-04): the deploy role must trust
# BOTH owners' subjects until the transfer is done; then github_repository/github_owner_id move
# to the new owner and this goes back to null.
variable "github_transfer_to" {
  description = "Owner the repository is being transferred to; null once the transfer is complete."
  type = object({
    owner    = string
    owner_id = number
  })
  default = {
    owner    = "notori0us"
    owner_id = 2278744
  }
}
