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
