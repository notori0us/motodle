terraform {
  # D9 withdrew use_lockfile, so the cloud{} block only truly needs >= 1.1; pinned to match the
  # pinned operator/agent install (§13.6 step 1) rather than left as a stale, non-load-bearing floor.
  required_version = ">= 1.16"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# CloudFront viewer certificates must live in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}
