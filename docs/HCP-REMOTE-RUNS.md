# Migrating `motodle` Terraform to HCP remote, VCS-driven runs with dynamic AWS credentials

> **Status 2026-09-04:** steps 1–3 of §4 done (role `motodle-terraform-run` applied via terraform-core PR #1, run `run-vDqn67udX3KfU6hV`); §3 steps 0–2 done via the API (varset de-globalized and pinned to terraform-core, both vars now `env`, terraform-core plan-only `run-GMyTxU8ijMkdELt4` clean with zero warnings; `motodle` has its two env vars, execution mode `remote`, working directory `infra`). **Remaining: §3 step 3 (connect the GitHub App in the UI, trigger `infra/**`, auto-apply off) and the first plan-only run (§4 step 7), then §5 verification.**

*Researched 2026-09-04 against the live HCP API, the live AWS account `051946164308`, and current HashiCorp docs. Nothing was changed by the research. Goal: nobody ever runs `terraform apply` from a laptop again — the same posture `terraform-core` already has.*

---

## 1. Current state

### HCP workspaces (org `reenchree`, both in project `prj-ZtNDmLit5zYnPLHK` = "Default Project")

| | `motodle` (`ws-AbRYmYGwq43YfTv1`) | `terraform-core` (`ws-3kczDHB4kjjkMhAc`) |
|---|---|---|
| Execution mode | **`local`** (`setting-overwrites.execution-mode: true`) | `remote` (org default) |
| VCS | **none** | `github_app`, `reenchree/terraform-core`, install `ghain-znnFHszW6frTYGv2` |
| Auto-apply | `false` | **`true`** |
| Working directory | `null` | `null` |
| Trigger patterns/prefixes | `[]` / `[]`, `file-triggers-enabled: true` | `[]` / `[]` |
| Terraform version | **1.16.1** | 1.12.1 |
| Workspace variables | none | none |
| `queue-all-runs` | `false` | — |
| Resources / runs | 28 resources, **0 runs** (local exec writes state versions only; latest `sv-sWwu3d1Zuo7CTaFZ`, serial 14, 2026-09-03T00:43Z) | 35 resources, last run `run-LMCK4SSiBfR6Y6rb` applied 2026-09-04T17:45Z |

### The only credential configuration in the org

One **global** variable set, `varset-NvJQF8yQ2ucpJ4ie` "AWS Settings" (`global=true`, no workspace/project attachments), containing exactly two variables:

- `TFC_AWS_PROVIDER_AUTH` = `true`
- `TFC_AWS_RUN_ROLE_ARN` = `arn:aws:iam::051946164308:role/TerraformRunnerRole`

**Both are `category: "terraform"`, not `"env"`.** The docs require environment variables. Empirically it still works *and* leaks: `terraform-core`'s plan log ends with two `Warning: Value for undeclared variable` diagnostics naming both keys, read from `terraform.tfvars` — and the plan's `json-output` shows `data.aws_caller_identity.current.arn` = `arn:aws:sts::051946164308:assumed-role/TerraformRunnerRole/terraform-run-run-LMCK4SSiBfR6Y6rb`. So HCP honours the keys by name regardless of category, and also dumps them into tfvars.

**Two facts this exposes, both load-bearing for this migration:**

1. The varset is **global**, so `motodle` *already inherits* `TFC_AWS_RUN_ROLE_ARN=TerraformRunnerRole`. Flip execution mode to `remote` today and motodle silently runs as an **AdministratorAccess** role.
2. `TerraformRunnerRole`'s trust is `organization:reenchree:project:*:workspace:*:run_phase:*` — **any** workspace in the org gets admin. Pre-existing, not created by this migration, but it is the reason to give motodle its own role rather than reuse this one.

### The role `terraform-core` runs as

`arn:aws:iam::051946164308:role/TerraformRunnerRole` — created 2025-05-24T06:16:20Z, one attached policy: `arn:aws:iam::aws:policy/AdministratorAccess`, no inline policies, `MaxSessionDuration` 3600.

**It is not defined in Terraform anywhere.** Both the role and the `app.terraform.io` OIDC provider (created 2025-05-24T06:04:36Z) were bootstrapped by hand and are unmanaged. `terraform-core/CLAUDE.md` says auth is via an `AWS_ROLE_ARN` env var — that is stale; the real mechanism is the `TFC_AWS_*` varset above.

### OIDC providers present in AWS

| ARN | Client IDs | Managed by |
|---|---|---|
| `…:oidc-provider/app.terraform.io` | `aws.workload.identity`, thumbprint `06b25927c42a721631c1efd9431e648fa62e1e39` | **nothing — out-of-band** |
| `…:oidc-provider/sea-k8s-oidc-051946164308.s3.us-west-2.amazonaws.com` | `sts.amazonaws.com` | `terraform-core/k8s_irsa.tf` |
| `…:oidc-provider/token.actions.githubusercontent.com` | `sts.amazonaws.com` | `terraform-core/iam_github.tf` (motodle consumes it as a `data` source in `infra/data.tf`) |

### Repo files

`infra/backend.tf` is a bare `cloud {}` block (org `reenchree`, workspace `motodle`). `infra/versions.tf` declares `required_version >= 1.16`, `hashicorp/aws ~> 5.0`, a default provider on `var.aws_region` (`us-west-2`) and an alias `aws.us_east_1`. `docs/PLAN.md` §13.3 fixes local execution as a deliberate D9 decision and names this migration as a documented later upgrade. **Nothing in `infra/` needs to change for this migration.**

**HEAD is in sync with applied state.** The live `motodle-github-deploy` role already carries both OIDC subject forms (commit `23330a5` was applied), and the budget commit `b6603f2` was reverted before ever being applied (budgets live in `terraform-core/budget.tf`). **So the first remote plan should be 0 changes.**

---

## 2. Target design

### 2a. The role, defined in `terraform-core` (new file `tfc_motodle.tf`)

```hcl
# tfc_motodle.tf -- run role for the HCP Terraform workspace `motodle`.

# Bootstrapped out-of-band 2025-05-24; NOT managed here. Reference, never re-declare:
# a `resource` block would try to create a duplicate provider and fail.
data "aws_iam_openid_connect_provider" "hcp_terraform" {
  url = "https://app.terraform.io"
}

data "aws_iam_policy_document" "motodle_run_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.hcp_terraform.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "app.terraform.io:aud"
      values   = ["aws.workload.identity"]
    }

    # sub = organization:<org>:project:<project>:workspace:<ws>:run_phase:<plan|apply>
    # The project is literally named "Default Project" (with a space) and is renameable;
    # workspace names are unique per org, so wildcard the project and pin the workspace.
    condition {
      test     = "StringLike"
      variable = "app.terraform.io:sub"
      values = [
        "organization:reenchree:project:*:workspace:motodle:run_phase:plan",
        "organization:reenchree:project:*:workspace:motodle:run_phase:apply",
      ]
    }
  }
}

resource "aws_iam_role" "motodle_run" {
  name                 = "motodle-terraform-run"
  description          = "HCP Terraform workspace `motodle` run role (plan + apply)"
  assume_role_policy   = data.aws_iam_policy_document.motodle_run_assume.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "motodle_run" {
  name = "motodle-terraform"
  role = aws_iam_role.motodle_run.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # infra/s3.tf site bucket + LAUNCH.md A.3 logs bucket. Bounded by name prefix.
      { Sid = "SiteAndLogBuckets", Effect = "Allow", Action = "s3:*",
        Resource = ["arn:aws:s3:::motodle-*", "arn:aws:s3:::motodle-*/*"] },

      # CloudFront has no resource-level authz for CreateDistribution, cache policies,
      # functions, OAC or response-headers policies -- "*" is the only workable scope.
      { Sid = "CloudFront", Effect = "Allow", Action = "cloudfront:*", Resource = "*" },

      # acm:RequestCertificate likewise takes no resource ARN.
      { Sid = "Acm", Effect = "Allow", Action = "acm:*", Resource = "*" },

      { Sid = "Route53Zone", Effect = "Allow",
        Action   = ["route53:ChangeResourceRecordSets", "route53:ListResourceRecordSets", "route53:GetHostedZone", "route53:ListTagsForResource"],
        Resource = "arn:aws:route53:::hostedzone/Z068366433JSADZ25QFLX" },
      { Sid = "Route53Change", Effect = "Allow", Action = "route53:GetChange",
        Resource = "arn:aws:route53:::change/*" },
      # data.aws_route53_zone does ListHostedZonesByName, which requires "*".
      { Sid = "Route53Lookup", Effect = "Allow",
        Action = ["route53:ListHostedZones", "route53:ListHostedZonesByName"], Resource = "*" },

      { Sid = "DeployRole", Effect = "Allow",
        Action = ["iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:UpdateRole",
          "iam:UpdateAssumeRolePolicy", "iam:TagRole", "iam:UntagRole", "iam:ListRoleTags",
          "iam:PutRolePolicy", "iam:GetRolePolicy", "iam:DeleteRolePolicy", "iam:ListRolePolicies",
        "iam:ListAttachedRolePolicies"],
        Resource = "arn:aws:iam::051946164308:role/motodle-github-deploy" },
      # data.aws_iam_openid_connect_provider in infra/data.tf
      { Sid = "ReadGithubOidcProvider", Effect = "Allow",
        # the by-URL lookup lists all providers first
        Action   = ["iam:GetOpenIDConnectProvider", "iam:ListOpenIDConnectProviders"],
        Resource = "arn:aws:iam::051946164308:oidc-provider/*" },

      # LAUNCH.md A.3 (CloudFront standard logs v2, us-east-1 only) -- add when A.3 lands.
      { Sid = "LogDelivery", Effect = "Allow", Action = ["logs:PutDeliverySource", "logs:GetDeliverySource",
        "logs:DeleteDeliverySource", "logs:PutDeliveryDestination", "logs:GetDeliveryDestination",
        "logs:DeleteDeliveryDestination", "logs:PutDeliveryDestinationPolicy",
        "logs:GetDeliveryDestinationPolicy", "logs:DeleteDeliveryDestinationPolicy",
        "logs:CreateDelivery", "logs:GetDelivery", "logs:DeleteDelivery",
        "logs:UpdateDeliveryConfiguration"],
        Resource = ["arn:aws:logs:us-east-1:051946164308:delivery:*",
          "arn:aws:logs:us-east-1:051946164308:delivery-source:*",
        "arn:aws:logs:us-east-1:051946164308:delivery-destination:*"] },
      { Sid = "LogDeliveryRead", Effect = "Allow",
        Action = ["logs:DescribeDeliveries", "logs:DescribeDeliverySources",
        "logs:DescribeDeliveryDestinations", "logs:DescribeConfigurationTemplates"], Resource = "*" },

      # Closes the escalation hole: the role must never edit its own trust policy.
      { Sid = "DenySelfMutation", Effect = "Deny", Action = "iam:*",
        Resource = aws_iam_role.motodle_run.arn },
    ]
  })
}

output "motodle_run_role_arn" {
  description = "TFC_AWS_RUN_ROLE_ARN for the HCP workspace `motodle`."
  value       = aws_iam_role.motodle_run.arn
}
```

`budget.tf` already lives in `terraform-core`, so no `budgets:*` is needed here. LAUNCH.md B7 adds SNS + CloudWatch alarms — add `sns:*` on `arn:aws:sns:us-west-2:051946164308:motodle-*` and `cloudwatch:PutMetricAlarm`/`DeleteAlarms`/`DescribeAlarms` on `*` when that lands.

**Where least privilege is impractical, honestly:** CloudFront and ACM. Neither supports resource-level authorization for the creating calls this module makes, so those two statements are `Resource: "*"` no matter what. Everything else is genuinely bounded (bucket prefix, one hosted zone, one role ARN, one region for logs).

**Recommendation: use the scoped policy above, not `AdministratorAccess`.** Most of the security value is in the *trust* policy (workspace-scoped subject instead of `workspace:*`), but the permissions policy is the only thing between a bad `.tf` commit in a public-facing hobby repo and the rest of the account (sea-k3s IRSA roles, Cognito, the `reenchree-archive` backup bucket). Attaching `AdministratorAccess` to `motodle-terraform-run` would still be a strict improvement over the status quo, but it is the fallback, not the recommendation.

### 2b. The `aws.us_east_1` alias needs no changes

For the default (untagged) dynamic-credentials configuration, HCP performs `AssumeRoleWithWebIdentity` itself and injects the credentials into the run environment. Every `provider "aws"` block with no explicit credentials — including `aws.us_east_1` — picks them up from the standard credential chain. Per-provider `TFC_AWS_PROVIDER_AUTH_<TAG>` / `TFC_AWS_RUN_ROLE_ARN_<TAG>` variables are only needed when an alias must use a **different** role. One role for both regions: no HCL change.
([aws-configuration](https://developer.hashicorp.com/terraform/cloud-docs/dynamic-provider-credentials/aws-configuration), [multiple configurations](https://developer.hashicorp.com/terraform/cloud-docs/dynamic-provider-credentials/specifying-multiple-configurations))

---

## 3. HCP workspace changes — ordered operator checklist

> **Step 0 is a precondition, not optional.** The global "AWS Settings" varset hands `TerraformRunnerRole` to every workspace. Fix it before motodle goes remote, or motodle runs as admin.

**0. De-globalize and fix the varset** (UI: *Settings → Variable sets → AWS Settings*)
- Uncheck "Apply globally"; attach it to **`terraform-core` only**.
- Delete both variables and recreate them with **category `env`** (this also kills the two `Value for undeclared variable` warnings in every terraform-core plan): `TFC_AWS_PROVIDER_AUTH` = `true`, `TFC_AWS_RUN_ROLE_ARN` = `arn:aws:iam::051946164308:role/TerraformRunnerRole`.
- Verify: push a whitespace commit to `terraform-core`, confirm the run still applies **and** the warnings are gone.
- *Why not override at workspace level:* workspace variables override varset variables of the same key **and category**. An `env` workspace var does not displace a `terraform`-category varset var; precedence between the two is undocumented. Removing the ambiguity is cheaper than reasoning about it.

**1. Add motodle's workspace variables** (*Workspace `motodle` → Variables → Add variable → Environment variable*)

| Key | Value | Category | Sensitive |
|---|---|---|---|
| `TFC_AWS_PROVIDER_AUTH` | `true` | env | no |
| `TFC_AWS_RUN_ROLE_ARN` | `arn:aws:iam::051946164308:role/motodle-terraform-run` | env | no |

**2. Execution mode → remote** (must precede the VCS connection; HCP will not attach VCS to a `local` workspace)

```bash
TOKEN=$(jq -r '.credentials["app.terraform.io"].token' ~/.terraform.d/credentials.tfrc.json)
curl -sS --request PATCH \
  --header "Authorization: Bearer $TOKEN" \
  --header "Content-Type: application/vnd.api+json" \
  --data '{"data":{"type":"workspaces","attributes":{"execution-mode":"remote","working-directory":"infra"}}}' \
  https://app.terraform.io/api/v2/workspaces/ws-AbRYmYGwq43YfTv1
```

**3. Connect VCS — UI only.** The VCS provider is a GitHub App installation (`ghain-znnFHszW6frTYGv2`); the API token cannot enumerate or attach it (`GET /api/v2/github-app/installations` → `400 no github app oauth token for user`). *Workspace → Settings → Version Control → Connect to version control → GitHub App →* `reenchree/motodle`. Set:
- **Branch**: `main`
- **Terraform Working Directory**: `infra`
- **Automatic Run Triggering**: *Only trigger runs when files in specified paths change* → **Trigger patterns**: `infra/**` (patterns, not prefixes)
- **Auto apply**: **off** — see below.
- Leave *Include submodules on clone* off.

**4. Auto-apply — recommend OFF.** `reenchree/motodle` pushes straight to `main` with no PR gate, so there are no speculative plans; auto-apply would take a `.tf` typo from `git push` to a mutated CloudFront distribution with no human ever seeing a plan. Infra changes here are rare and the confirm click costs seconds. Turn it on only if PR-required branch protection lands first.

**5. `infra/backend.tf` — keep the `cloud {}` block unchanged.** It identifies the workspace and stays correct for VCS-driven runs. Local behaviour after the switch: `terraform output` / `state list` still work; `terraform plan` becomes a speculative remote plan; `terraform apply` is **rejected** with *"Apply not allowed for workspaces with a VCS connection"* — that rejection is the whole point. ([support KB](https://support.hashicorp.com/hc/en-us/articles/4408827333395), [VCS settings](https://developer.hashicorp.com/terraform/cloud-docs/workspaces/settings/vcs))

**6. Update** the workspace description (currently "Local execution: state only."), `docs/PLAN.md` §13.3, and `terraform-core/CLAUDE.md` (the `AWS_ROLE_ARN` line is stale).

---

## 4. Migration order — and the bootstrapping trap

**The trap:** `motodle-terraform-run` must exist in AWS before motodle's first remote run, but it is created by `terraform-core`, which is itself VCS-driven with auto-apply — so its creation is a `git push`. Do the two repos in this order and never overlap them.

1. **terraform-core:** commit `tfc_motodle.tf` on a branch, open a PR, read the speculative plan (expect: 1 `aws_iam_role` + 1 `aws_iam_role_policy` created, 1 data source read, 1 output).
2. **Merge to `main`.** Auto-apply runs it. Wait for `applied`.
3. **Verify in AWS**: `aws iam get-role --role-name motodle-terraform-run` returns the role with the `workspace:motodle` subject condition. Do not proceed until this returns 200.
4. **HCP step 0** (de-globalize + re-category the varset), then verify terraform-core still applies cleanly.
5. **HCP steps 1–2** on motodle: add the two `env` variables, then PATCH `execution-mode: remote` + `working-directory: infra`.
6. **HCP step 3**: connect VCS in the UI with trigger patterns and auto-apply **off**.
7. **First remote run — a plan the operator reads.** `queue-all-runs` is `false`, so connecting VCS queues nothing; use *Actions → Start new run → Plan only*. Expected: **No changes.** If it shows changes, stop and read them.
8. Only after a clean plan-only run, push a trivial `infra/` change (a comment) and confirm the webhook fires a run that needs a manual *Confirm & Apply*.

**Rollback** (any step, no state risk — state is workspace-scoped and untouched):

```bash
# 1. Back to local execution
curl -sS --request PATCH -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/vnd.api+json" \
  --data '{"data":{"type":"workspaces","attributes":{"execution-mode":"local"}}}' \
  https://app.terraform.io/api/v2/workspaces/ws-AbRYmYGwq43YfTv1
# 2. Disconnect VCS in the UI (Settings -> Version Control -> Disconnect)
#    -- required to re-enable local `terraform apply`; execution-mode alone does not lift the block.
# 3. aws sso login && terraform -chdir=infra init && ... apply
```

`infra/*.tf` never changes, so rollback is purely a workspace-settings revert. The role can stay; it is inert if unused.

---

## 5. Verification

```bash
TOKEN=$(jq -r '.credentials["app.terraform.io"].token' ~/.terraform.d/credentials.tfrc.json)

# (a) execution mode, VCS repo, working directory, triggers, auto-apply
curl -sS -H "Authorization: Bearer $TOKEN" \
  https://app.terraform.io/api/v2/organizations/reenchree/workspaces/motodle \
| jq '{exec: .data.attributes."execution-mode", vcs: .data.attributes."vcs-repo".identifier,
       branch: .data.attributes."vcs-repo".branch, wd: .data.attributes."working-directory",
       patterns: .data.attributes."trigger-patterns", auto_apply: .data.attributes."auto-apply"}'
# expect: exec "remote", vcs "reenchree/motodle", branch "main", wd "infra", patterns ["infra/**"], auto_apply false

# (b) env variables are present and env-category
curl -sS -H "Authorization: Bearer $TOKEN" https://app.terraform.io/api/v2/workspaces/ws-AbRYmYGwq43YfTv1/vars \
| jq -r '.data[] | "\(.attributes.category)\t\(.attributes.key)"'
# expect exactly: env TFC_AWS_PROVIDER_AUTH / env TFC_AWS_RUN_ROLE_ARN

# (c) the no-op plan (UI "Start new run -> Plan only", then:)
curl -sS -H "Authorization: Bearer $TOKEN" \
  'https://app.terraform.io/api/v2/workspaces/ws-AbRYmYGwq43YfTv1/runs?page%5Bsize%5D=1' \
| jq -r '.data[0] | "\(.id) \(.attributes.status) has-changes=\(.attributes."has-changes")"'
# expect: run-XXXX planned_and_finished has-changes=false

# (d) prove the run assumed the NEW role, not TerraformRunnerRole
PLAN=$(curl -sS -H "Authorization: Bearer $TOKEN" "https://app.terraform.io/api/v2/runs/<RUN_ID>?include=plan" \
  | jq -r '.included[]|select(.type=="plans")|.id')
curl -sSL -H "Authorization: Bearer $TOKEN" "https://app.terraform.io/api/v2/plans/$PLAN/json-output" \
| grep -o 'assumed-role/[A-Za-z0-9_-]*' | sort -u
# expect: assumed-role/motodle-terraform-run

# (e) the role itself
aws iam get-role --role-name motodle-terraform-run | jq '{arn:.Role.Arn, max:.Role.MaxSessionDuration, trust:.Role.AssumeRolePolicyDocument}'
aws iam list-role-policies --role-name motodle-terraform-run

# (f) laptop applies are actually blocked
cd infra && terraform apply
# expect: "Error: Apply not allowed for workspaces with a VCS connection"
```

---

## 6. Risks

1. **OIDC subject drift.** This account already hit GitHub's immutable-subject change for the deploy role (commit `23330a5`). HCP's subject format is a different, stable contract, but the failure mode is the same: a trust condition that silently stops matching yields `AccessDenied` on `AssumeRoleWithWebIdentity`, not a clear error. The project is literally named "Default Project" and is renameable; wildcarding `project:*` while pinning `workspace:motodle` avoids that without loosening anything meaningful.
2. **The VCS connection cannot be scripted.** GitHub App installation; the operator must do it in the browser, and `reenchree/motodle` (private, under the `reenchree` org) must be inside the App installation's repository selection — if the App was installed with "only select repositories", edit the install on GitHub first.
3. **Global varset admin exposure (pre-existing).** Until step 0, every workspace in `reenchree` inherits `TerraformRunnerRole` (trust `workspace:*`, policy `AdministratorAccess`). Anyone who can create a workspace in the org has admin on the account. Separately, `TerraformRunnerRole` and the `app.terraform.io` OIDC provider are unmanaged — a future `import {}` into `terraform-core` is worth doing but carries a self-lockout trap (terraform-core would be editing the trust policy of the role it runs as).
4. **Concurrent runs on the same push.** A push touching both `src/` and `infra/` triggers GitHub Actions `deploy.yml` and an HCP run; they share no lock and barely share resources (the deploy role only puts objects and creates invalidations; Terraform touches distribution config). With auto-apply off it cannot happen unattended.
5. **Terraform version skew.** Motodle pinned to 1.16.1, terraform-core to 1.12.1. Remote runs use the workspace pin; do not let it drift to `latest`.
6. **`working-directory: infra` and lockfile provenance.** Remote runs honour the committed `infra/.terraform.lock.hcl` (`hashicorp/aws 5.100.0`). LAUNCH.md A.3 depends on that pin (the v6 registry render advertises a `region` argument that does not exist in 5.x). Keep the lockfile in git.

**Sources:** [Dynamic credentials with the AWS provider](https://developer.hashicorp.com/terraform/cloud-docs/dynamic-provider-credentials/aws-configuration) · [Workload identity token claims](https://developer.hashicorp.com/terraform/cloud-docs/dynamic-provider-credentials/workload-identity-tokens) · [Specifying multiple configurations](https://developer.hashicorp.com/terraform/cloud-docs/dynamic-provider-credentials/specifying-multiple-configurations) · [Workspace VCS settings](https://developer.hashicorp.com/terraform/cloud-docs/workspaces/settings/vcs) · [Apply not allowed for VCS-connected workspaces](https://support.hashicorp.com/hc/en-us/articles/4408827333395)
