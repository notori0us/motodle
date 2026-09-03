# Motodle launch plan

**Repo:** `/home/chris/workspace/motodle` · **Live:** https://playmotodle.com · **Date:** 2026-09-03

Produced by a recon → plan → critique workflow: four recon reports, one consolidated plan, then two
adversarial critiques (privacy/CSP/correctness, and ops/cost). Every blocker and every improvement those
critiques raised is applied in place below — §F logs each item and how it was applied.

**How to read.** **OPERATOR ACTION** marks a step only the operator can perform: anything touching AWS, Terraform state, GitHub repository settings, or posting to a public venue. Everything else in this document is implementable by an agent working inside the repo.

**Reading key.** `[repo-readiness §N]`, `[analytics §N]`, `[community §N]`, `[ops §N]` cite the four recon reports. `UNVERIFIED` marks any claim about AWS or provider behaviour that no recon report established; those must be proved by the **operator (OPERATOR ACTION)** before they are relied on — an implementer agent has no AWS session and cannot prove any of them. Every workstream in §B is independently executable **except B1, which is a hard prerequisite for B2, B3 and B4** (see B1's rationale), **and B7(b), which needs B1 edit 3 to exist and needs the operator to have applied B7's `cloudfront:GetInvalidation` IAM change before it reaches `main`** (see B7).

**Recon conflicts resolved.**
- *Requests per visit.* `[ops §1]` enumerates 7 requests on a bounce / 11 on a full playthrough from the actual code paths; `[analytics §0]` says "~12". **Trusted `[ops §1]`** — it names each request and the code line that issues it, and correctly excludes `manifest.json` (fetched only by Archive/Credits).
- *Query strings and the CloudFront cache key.* `[ops §5]` reasons from the Terraform; `[analytics §0]` verified it live (`curl -sI "https://playmotodle.com/?ref=reddit_test"` → `x-cache: Hit from cloudfront`). **Trusted `[analytics §0]`** — it is an observation, not an inference.
- *Everything else agrees across reports.*

---

# A. Analytics

## A.1 Recommended design

**Primary — zero client code, zero CSP change:**

1. **CloudFront standard logging v2 → a private S3 log bucket, queried with Athena.** Every viewer request (cache hits included) writes one JSON line carrying `cs-uri-stem`, `cs-uri-query`, `cs(Referer)`, `cs(User-Agent)`, `sc-status`, `x-edge-result-type` and `c-country` `[analytics §b1]`. `record_fields` is an explicit subset, so **`c-ip` and `x-forwarded-for` are omitted** — the log then contains no direct identifier `[analytics §b1]`.
2. **A per-venue landing parameter, `https://playmotodle.com/?r=<code>`.** Verified live: the query string is in no cache policy's cache key (`query_string_behavior = "none"` on all three policies), so the tagged URL serves the already-cached `index.html` as an edge **Hit** — no origin fetch, no extra byte — and CloudFront still logs `r=<code>` in `cs-uri-query` `[analytics §0, §g]`. `GameStore.init()` calls `history.replaceState` **only** when `?d=` is present, so `?r=` survives harmlessly and never disturbs the game `[analytics §g]`. Files touched: **none.** Cost: **$0.**

**Why the pair is enough on its own.** `full.webp` is fetched only by `ResultModal.svelte` at game end `[ops §1]`, and each day's path is unique (`/puzzles/img/NNNN/full.webp`). So

> completion proxy = `count(rows where cs-uri-stem LIKE '/puzzles/img/%/full.webp')` ÷ `count(rows where cs-uri-stem = '/')`

is a **completion rate available from logs alone**, and on launch day it is also visible with zero setup in the free CloudFront console *Popular objects* report `[analytics §a]`. The `/` denominator needs a bot user-agent filter; the `full.webp` numerator does not (bots do not execute JS).

**Optional add-on (recommended) — a first-party image beacon.** The one thing logs cannot see is a **share**: `handleShare()` writes to the clipboard, issuing no network request. The beacon also splits the completion proxy into won / lost / gave-up. It needs **no CSP change** — today's `img-src 'self' data:` already matches any path and query on the origin, because a CSP source expression with no `path-part` matches the whole origin `[analytics §0]`. Four files, ~25 lines, no `.tf` change.

**Not a decision — already on, free, use it on day one.** The CloudFront console *Reports & Analytics* pages (Cache statistics, Popular objects, Top referrers, Viewers/Locations) require **no configuration and no access logs** and cover a rolling 60 days `[analytics §a]`. Standard logging v2 takes about **four hours after enabling before delivery is reliable** and can lag up to 24 h `[analytics §b1]`, so the console is the launch-hour instrument and Athena is the record.

## A.2 Why this beats the alternatives under F1/F2

| Option | One-line reason it loses |
|---|---|
| **(a) Console reports alone** | Rolling 60-day window, no export, referrers are top-25 *domains* by *request* count, and there is no completion or share signal `[analytics §a]`. Kept as a day-one supplement, not the record. |
| **(b2) Standard logs, legacy** | Requires an **ACL-enabled** bucket — CloudFront refuses `BucketOwnerEnforced`, which is the posture every bucket in this account uses; also has no field selection (so `c-ip` is mandatory) and no `c-country`, and it modifies and redeploys the live distribution `[analytics §b2]`. |
| **(f) Real-time logs → Kinesis** | ~$11–36/month floor for a permanently-running stream — 20–70× the whole stack — to buy sub-second latency on a question answered fine within the hour `[analytics §f]`. Breaks F2. |
| **(d) Self-hosted Umami/Plausible on sea-k3s** | Adds a third-party script tag and a **home-network hostname** to a public page, needs the CSP relaxed in four files plus a distribution apply, and when the residential link is down every visitor's tab hangs on a dead connection until timeout `[analytics §d]`. Breaks F1's "no third-party scripts"; degrades the public site during a home outage, which is the spirit of F2. |
| **(e) Hosted SaaS (Plausible/Fathom/Cloudflare/GoatCounter/Umami Cloud)** | Third-party script → breaks F1 outright; data leaves the operator; ad-blockers block those endpoints far harder than a first-party path `[analytics §e]`. |
| **(e) GA4 specifically** | Sets `_ga` first-party cookies by default → ePrivacy Art 5(3) consent banner in the EU, which F5 rules out `[analytics §e]`. |
| **`navigator.sendBeacon` (the brief's own suggestion)** | sendBeacon always POSTs and every behaviour is `allowed_methods = ["GET","HEAD"]` → **405**. CloudFront offers no GET+POST set, so enabling it means enabling PUT/DELETE `[analytics §0]`. Use an `Image` GET. |
| **`/px.gif` (the brief's own suggestion)** | `/px.gif?` is an **unscoped EasyPrivacy rule** that blocks first-party URLs too — as are `/pixel.gif?`, `/beacon.gif?`, `/m.gif?`, `/t.gif?`, `/e.gif?`, `/log.gif?`, `/count.gif?` and eight more. `/assets/mtd.gif?…` is clean against all 56,791 rules `[analytics §c]`. A root-level `.gif` also fails the deploy's cache-class assertion. |
| **A page-view beacon** | The `index.html` log row *is* the page view and already carries the referrer, country, UA and `?r=` — a load-time beacon adds a request and ad-block surface for nothing `[analytics §c]`. |
| **`localStorage` new-vs-returning flag** | An analytics-only flag is storage in terminal equipment → exactly what ePrivacy Art 5(3) governs, dragging a consent question into a site that has none `[analytics, "Consent"]`. |

**Consent.** ePrivacy Art 5(3) governs *storing information on, or accessing information already stored on, terminal equipment*. Reading `Referer`, `User-Agent` and `cs-uri-query` off a request the browser sends anyway is neither — **no banner is triggered** `[analytics, "Consent"]`. Dropping `c-ip` from `record_fields` removes the only field that would be personal data under GDPR (CJEU C-582/14 *Breyer*), so no legitimate-interest analysis is needed at all. The app's existing `localStorage` game state is "strictly necessary … to provide the service explicitly requested" and is unaffected.

## A.3 Terraform contracts — new file `/home/chris/workspace/motodle/infra/logs.tf`

Every resource below is new. **All three `aws_cloudwatch_log_delivery*` resources MUST carry `provider = aws.us_east_1`** — the CloudWatch delivery API for CloudFront is us-east-1 only `[analytics §b1]`. The alias already exists at `infra/versions.tf:20-23`. The public registry now renders the **v6** schema, which advertises a per-resource `region` argument that **does not exist in the pinned 5.x provider** (`infra/.terraform.lock.hcl` pins `hashicorp/aws 5.100.0`); an implementer copying the registry example verbatim gets `Unsupported argument: region` `[analytics §b1]`. No provider bump is needed — these resources landed in v5.83.0 `[analytics §0]`.

```hcl
# infra/logs.tf — CloudFront standard access logs v2 -> S3, for launch measurement (PLAN §13.8 revisit).

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

  # Mirrors the working pattern at infra/s3.tf:83 (aws_s3_bucket_policy.site) -- the public access
  # block must exist before the policy, or the policy put can race it.
  depends_on = [aws_s3_bucket_public_access_block.logs]
}

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

  # c-ip and x-forwarded-for are DELIBERATELY ABSENT (operator decision D2). Adding either turns
  # this log into GDPR personal-data processing; omitting them costs only the IP+UA "unique
  # visitor" approximation, which is wrong in both directions anyway.
  # x-edge-location is ALSO deliberately absent (IM9): nothing in Q1-Q7 reads it, and alongside
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

  # Provider 5.100.0 has two known defects here, fixed only in v6: a spurious
  # "Provided delivery configuration is invalid for the destination type" on an unchanged block,
  # and suffix_path losing the AWS-added prefix on update. Expect a bad diff on the SECOND apply.
  lifecycle {
    ignore_changes = [s3_delivery_configuration]
  }
}
```

Append to `/home/chris/workspace/motodle/infra/outputs.tf`:

```hcl
output "logs_bucket" {
  description = "S3 bucket receiving CloudFront standard access logs v2."
  value       = aws_s3_bucket.logs.bucket
}
```

**OPERATOR ACTION — this applies to every `terraform init`, `terraform validate`, `terraform plan` and `terraform apply` in this document (A.3, B7, B8), not only to this block.** `infra/backend.tf` carries a `cloud {}` block (org `reenchree`, workspace `motodle`), so `init` needs an HCP Terraform token and `plan` needs a live AWS session — and the SSO session on this machine is expired. **An implementer agent cannot run any of them.** The implementer's only gate is:

```bash
terraform fmt -check -diff /home/chris/workspace/motodle/infra
```

No init, no credentials, no network. Until the operator plans, treat every HCL block in this document as **well-formed but unvalidated**; if an argument is rejected, fix it against the **pinned 5.100.0** provider docs, never the v6 registry render.

**Operator IAM** must additionally allow `logs:PutDeliverySource`, `logs:PutDeliveryDestination`, `logs:CreateDelivery`, `logs:GetDelivery*`, `logs:DeleteDelivery*` scoped to `arn:aws:logs:us-east-1:051946164308:{delivery,delivery-source,delivery-destination}:*`, plus `logs:Describe*` on `*` `[analytics §b1]`. **AWS's own "user permissions" policy for vended log delivery names six more that the first draft omitted** — add `logs:UpdateDeliveryConfiguration`, `logs:PutDeliveryDestinationPolicy`, `logs:GetDeliveryDestinationPolicy`, `logs:DeleteDeliveryDestinationPolicy`, `logs:GetDeliverySource` and `logs:DescribeConfigurationTemplates`, plus `s3:GetBucketPolicy` and `s3:PutBucketPolicy` on the log bucket. The operator applies from the SSO `default` profile with AdministratorAccess, so this is expected to be a no-op — **UNVERIFIED** (recon could not read the account; the SSO session was expired in every recon run).

**Cost.** S3 storage is ~$0.004/month at 1k visits/day, ~$0.04 at 10k, ~$0.41 at 100k (uncompressed worst case; v2 compression is undocumented and could be ~8–10× lower). Athena is $5/TB with a 10 MB minimum per query — every query here costs $0.00005–$0.09 `[analytics §b]`. **The delivery charge is not ambiguous. It applies — stop hedging and budget for it.** AWS's own page states it verbatim: *"Even when you publish logs directly to Amazon S3 or Firehose, CloudWatch delivery charges apply. If you send logs to Amazon S3, then `{{AWS_REGION}}-S3-Egress-Bytes` charges appear in Cost Explorer or on your bill."* At vended-logs rates that is **cents per month at 1k–10k visits/day (~$0.02 at 1k, ~$0.19 at 10k) and a few dollars at 100k.** Note also, because A.3 presents it purely as an Athena-schema decision: **`output_format = "json"` roughly doubles delivered bytes versus `plain`**, so it is a real cost lever as well. The doubling is judged worth it at this volume — the schema survives any later `record_fields` edit — but it is a choice, not a free one. **After the first billing cycle, confirm the `USW2-S3-Egress-Bytes` line in Cost Explorer;** the AWS Budget in workstream B8 surfaces it either way.

## A.4 Repo files to touch (analytics only)

| Path | Change |
|---|---|
| `infra/logs.tf` | **New.** The block above, verbatim. |
| `infra/outputs.tf` | Append the `logs_bucket` output above. |
| `public/assets/mtd.gif` | **New (add-on).** A 43-byte 1×1 transparent GIF. Vite copies `public/**` verbatim into `dist/`, so it lands at `dist/assets/mtd.gif` — matched by the existing `! -path './assets/*'` exclusion in the deploy's cache-class assertion and uploaded by **Sync C** (`assets/*` minus `.js`/`.css`) with `cache-control: public, max-age=31536000, immutable` and content-type guessed from the extension `[analytics §0]`. **DoD gate: run `npm run build && ls dist/assets/` and confirm `mtd.gif` is present with no name collision against Vite's hashed bundles — recon could not run the build (RAILS) and flagged this as the implementer's first check.** |
| `src/lib/beacon.ts` | **New (add-on).** See A.5. |
| `src/lib/beacon.test.ts` | **New (add-on).** See A.5. |
| `src/state/game.svelte.ts` | **(add-on)** One import + one call at the end of `onGameEnded()` (anchor on `private onGameEnded(): void {`). |
| `src/App.svelte` | **(add-on)** One import + one call inside `handleShare()` (anchor on `function handleShare(): void {`). |
| `docs/PLAN.md` §13.8 | Edit the "CloudFront standard/real-time logging — *Revisit when: A real traffic question exists (e.g. 'did the launch land?')*" row to record that the trigger fired and v2 is now built. **Do not leave §13.8 silently contradicting the shipped stack** `[analytics, Risks]`. |

**No `.tf` change to `cloudfront.tf`, no CSP change, no change to `schema/constants.ts`, `infra/variables.tf`, `vite.config.ts` or `schema/csp-contract.test.ts`.** That is the point of this design.

## A.5 The beacon — literal contract

`/home/chris/workspace/motodle/src/lib/beacon.ts`, new file, complete:

```ts
/**
 * First-party analytics beacon (§13.8 launch measurement). One image GET per event, read back out
 * of the CloudFront access log's cs-uri-query field. No cookies, no storage, no third party, and
 * no CSP change: img-src 'self' already matches any path and query on this origin.
 */

// MUST stay under /assets/. A root-level path fails deploy.yml's cache-class assertion, and
// EasyPrivacy has unscoped rules blocking /px.gif?, /pixel.gif?, /beacon.gif?, /m.gif?, /t.gif?,
// /e.gif?, /log.gif? and 8 more -- those block FIRST-PARTY requests too. /assets/mtd.gif is clean.
const PATH = '/assets/mtd.gif';

/** won | lost | gave-up | shared. Nothing else is ever sent. */
export type BeaconEvent = 'w' | 'l' | 'g' | 's';

/**
 * The ONLY fields that may leave the browser. Typed exactly -- not Record<string, unknown> -- so
 * that adding an answer-derived field is a compile error rather than a judgement call.
 *   n = puzzle number (already in the share text, derivable from the date)
 *   q = the guess index the round ended at. ALWAYS 1..5. It is never 6:
 *         win     -> the winning guess, 1..5              (src/lib/game.ts:129)
 *         loss    -> always 5; endedAtGuess = guessNumber (src/lib/game.ts:134-144)
 *         give-up -> guesses.length + 1, so 1..5          (src/lib/game.ts:155-158, appends no row)
 *   s = score 0..15
 *   p = 1 for a practice round, 0 for the real day
 * NEVER add: puzzle.answer.*, today.locks.*, today.guesses[].{make,model,year},
 * today.guesses[].result (tile colours narrow country and year band in aggregate), or
 * puzzle.credit.* (§5.10.1 already bans these from the in-game subtree for this reason).
 */
export interface BeaconParams {
  n: number;
  q?: number;
  s?: number;
  p?: 0 | 1;
}

export function beacon(e: BeaconEvent, params: BeaconParams): void {
  // Hostname, NOT import.meta.env.PROD: `vite preview` -- what the Playwright suite runs against --
  // is a PROD build, so a PROD guard would fire beacons during e2e.
  if (typeof location === 'undefined' || location.hostname !== 'playmotodle.com') return;
  if (typeof Image === 'undefined') return;
  try {
    const qs = new URLSearchParams({ e });
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) qs.set(k, String(v));
    }
    // /assets/* is served `immutable`, so without a per-event nonce the BROWSER cache would swallow
    // a repeat and CloudFront would never log it. CloudFront's own cache key excludes the query
    // string (query_string_behavior = "none"), so every one of these is an edge Hit: no origin
    // fetch, no S3 GET, no invalidation ever needed.
    qs.set('c', Math.random().toString(36).slice(2, 10));
    new Image().src = `${PATH}?${qs}`;
  } catch {
    /* analytics must never break the game */
  }
}
```

Call site 1 — `src/state/game.svelte.ts`. Add `import { beacon } from '../lib/beacon';` to the existing import block, then as the **last statement** of `private onGameEnded()` (after the `setTimeout` that opens the result modal):

```ts
    beacon(
      this.today.status === 'won' ? 'w' : this.today.guesses.length < 5 ? 'g' : 'l',
      {
        n: this.puzzle!.number,
        q: this.today.endedAtGuess ?? 0,
        s: this.today.score ?? 0,
        p: this.isPractice ? 1 : 0,
      },
    );
```

`giveUp()` appends no guess row, so inside `onGameEnded()` a give-up is exactly `status === 'lost' && guesses.length < 5` — no new state is needed `[analytics §0]`. **The line numbers, cited so no implementer re-derives them:** `onGameEnded()`'s only callers are `submitGuess` (`src/state/game.svelte.ts:274`) and `giveUp` (`:284`), and both early-return on `!this.puzzle`, so the `!` is safe; `endedAtGuess` and `score` are declared at `:65-66`; `libGiveUp` appends no guess row (`src/lib/game.ts:155-158`), which is exactly what makes the discriminator correct. If the implementer prefers, wrap the call in `if (this.puzzle)`.

Call site 2 — `src/App.svelte`. Add `import { beacon } from './lib/beacon';` to the existing `<script lang="ts">` import block, then inside `handleShare()`, immediately after the existing `if (!game.puzzle) return;`:

```ts
    beacon('s', { n: game.puzzle.number, p: game.isPractice ? 1 : 0 });
```

**The `p` is load-bearing, not decoration — this is the single defect both critics flagged as a blocker.** Q5 and Q6 filter on `p=0` to exclude practice rounds. A share beacon with no `p` is dropped by that predicate before `count_if` runs, so `shared` reads **0 forever**, C.6's share gate becomes structurally unreachable, and D1's whole justification for shipping the beacon ("the only source of share rate") is defeated. Fix it at the source rather than in the query: relaxing Q5's `WHERE` would admit practice shares into a numerator whose denominator still excludes them. `game.isPractice` already exists (`src/state/game.svelte.ts:96`) and `handleShare()` already reads it (`src/App.svelte:48`), so this costs nothing.

**`e=s` counts share *attempts*, not completed shares — say so wherever the number is reported.** `handleShare()` is bound to `onshare` on **both** `StatsModal` (`src/App.svelte:211`) and `ResultModal` (`src/App.svelte:220`), and the beacon fires *before* `shareSink.share()` resolves. One player can therefore fire several `e=s` rows for one round: share from the result modal, dismiss the OS sheet, share again from the stats modal. **The ratio can legitimately exceed 100%.** Two ways to resolve it, and the choice is operator decision **D13**: (i) *default* — keep the call where it is and name the metric "share attempts per finished round", stating plainly that it can exceed 100% (A.6 Q5, C.6); (ii) move `beacon('s', …)` into the `.then()` and fire only for `outcome === 'copied' || outcome === 'shared'`, which measures completed shares but loses the manual-fallback path and adds a branch to a code path that currently cannot fail.

**Complete event list and beacon URL shape** (`<n>` = 8-char random nonce):

| Event | URL |
|---|---|
| Won | `https://playmotodle.com/assets/mtd.gif?e=w&n=42&q=3&s=11&p=0&c=<n>` |
| Lost (5 guesses used) | `https://playmotodle.com/assets/mtd.gif?e=l&n=42&q=5&s=4&p=0&c=<n>` |
| Gave up | `https://playmotodle.com/assets/mtd.gif?e=g&n=42&q=3&s=2&p=0&c=<n>` |
| Shared | `https://playmotodle.com/assets/mtd.gif?e=s&n=42&p=0&c=<n>` |
| Practice round of any of the above | same, with `p=1` |

**Events deliberately NOT sent** — each would leak or narrow the answer, which matters more here than usual because these URLs land in browser history, in the log, and in the devtools panel of anyone streaming or screen-sharing, and because F6 already leaves future puzzle JSON publicly readable:

- **no page-view / app-load event** (the `index.html` log row already is it, with referrer, country, UA and `?r=`);
- **no per-guess event** — a per-guess beacon carrying tile colours would let anyone aggregating first-guess results narrow the answer's country and on-sale year band long before the day closed `[analytics §c]`;
- **no guessed make / model / year**, in any encoding — the winning guess *is* the answer;
- **no lock state** (`today.locks.*`) — a lock is by definition a correct value;
- **no credit / photographer / Commons file title** (§5.10.1 already bans these in-game);
- **no level-reveal or image-load event** — the `l1..l5.webp` and `full.webp` log rows already give the reveal funnel for free, with no query string at all.

**Attribution limitation, state it plainly.** Under `strict-origin-when-cross-origin` a *same-origin* subresource sends the full referrer including its query, so a player who landed on `/?r=wg` fires a beacon whose `cs(Referer)` is `https://playmotodle.com/?r=wg` — completion *by venue* falls out with no extra client code `[analytics §c]`. But that only holds **within the page load that carried the tag**: a player who returns the next day, or reloads after the tag was replaced, sends a bare referrer and is unattributed. Treat by-venue completion as a floor, not a census. **One consequence worth one sentence so nobody hands out the wrong link:** `history.replaceState` fires only inside the `dParam` branch (`src/state/game.svelte.ts:190-191`) and strips the *entire* query string via `location.pathname + location.hash` — so a combined `/?r=wg&d=<date>` link loses its `?r=` tag before any beacon fires. Irrelevant for the `?r=`-only launch links in §C, fatal for a hand-rolled archive link. Do not combine the two parameters.

**`src/lib/beacon.test.ts` — the four assertions that make this contract enforceable.** Vitest runs in jsdom, where `location.hostname` is `localhost`, so the off-host case is the default:

1. **Off-host, nothing is sent.** Stub `globalThis.Image` with a spy constructor; call `beacon('w', { n: 1 })`; assert the constructor was **never** invoked.
2. **On-host, the URL shape is exact.** `vi.stubGlobal('location', { hostname: 'playmotodle.com' })`; call `beacon('w', { n: 42, q: 3, s: 11, p: 0 })`; assert the constructor ran once and the assigned `src` matches `/^\/assets\/mtd\.gif\?e=w&n=42&q=3&s=11&p=0&c=[a-z0-9]{8}$/`. This pins the parameter set — a future field added to `BeaconParams` fails this test, which is the point.
3. **The share event carries `p`.** *Added* alongside the win case above, which is unchanged. Call `beacon('s', { n: 42, p: 0 })` and assert the `src` matches `/^\/assets\/mtd\.gif\?e=s&n=42&p=0&c=[a-z0-9]{8}$/`. Without this, the `p` that Q5's entire share metric depends on can be dropped again silently — which is precisely what happened in the first draft of this plan.
4. **The nonce actually varies.** Two on-host calls produce two different `c` values (otherwise the browser's `immutable` cache swallows the second and CloudFront never logs it).

`vite.config.ts`'s vitest `include` already covers `src/**/*.test.ts`; remember `vi.unstubAllGlobals()` in an `afterEach`.

**Cost of the beacon at scale.** 1–2 extra requests per completed visit — **and each one is also a CloudFront Function invocation, which is the scarcest allowance in this stack, not merely a request.** `www_to_apex` is associated as a `viewer-request` function on **all five** cache behaviours including `/assets/*` (confirmed in `infra/cloudfront.tf`), so every beacon burns one of the 2M free monthly invocations — the limit that binds first (see the single cost table in B8). At 100k visits/day the beacon adds ~4.5M requests/month, ≈$4.50 once the 10M request allowance is exhausted, plus those invocations; at that traffic the *site* is already ~$37/month `[analytics §b]`, so it is noise. At the traffic F5 actually anticipates it is $0.

## A.6 Athena — setup and the query set (OPERATOR ACTION)

Run once, by hand, in the Athena console (no Terraform; a workgroup and a results bucket are optional and Athena will create a default results location on first use). **OPERATOR ACTION throughout §A.6:** every statement here needs a live AWS session, which an implementer agent does not have.

**Step 0, before trusting any column name:**

```sql
SELECT * FROM motodle_cf_logs LIMIT 5;
```

Confirm the JSON key casing that CloudFront actually emitted matches the DDL. If it does not, fix the DDL rather than the queries.

**DDL.** Use AWS's published partition-projection DDL for CloudFront JSON logs `[analytics §b1]`, with `<log-bucket>` = `motodle-logs-051946164308` and the distribution id `E2YJHE1Q9IYIZW`. Keep **all** columns even though `record_fields` is trimmed: the OpenX JsonSerDe returns `NULL` for a key that is absent, so the same DDL keeps working if the field list is ever edited.

**The `WITH SERDEPROPERTIES ('paths'=…)` clause is part of that published DDL and the first draft dropped it.** It maps the mixed-case JSON keys CloudFront actually emits — `cs(Host)`, `cs(Referer)`, `cs(User-Agent)`, `cs(Cookie)` — positionally onto the declared columns. Without it the SerDe falls back to OpenX's default `case.insensitive=TRUE` lowercasing, which is *exactly* the assumption Step 0 exists to catch, and which fails by returning silent `NULL` columns rather than an error. The list below is the 34 declared columns in declaration order with `c-country` appended — `c-country` is a **v2-only field that AWS's example predates**, so at Step 0 the operator should diff this list against the live rendering of AWS's DDL (docs.aws.amazon.com/athena/latest/ug/create-cloudfront-table-partition-json.html) rather than assume it. Confirmed non-issues, so they are not re-litigated: the backticked hyphen/parenthesis column names and `'projection.month.range'='01,12'` are AWS's own and Athena accepts both.

```sql
CREATE EXTERNAL TABLE motodle_cf_logs (
  `date` string, `time` string, `x-edge-location` string, `sc-bytes` string,
  `c-ip` string, `cs-method` string, `cs(host)` string, `cs-uri-stem` string,
  `sc-status` string, `cs(referer)` string, `cs(user-agent)` string, `cs-uri-query` string,
  `cs(cookie)` string, `x-edge-result-type` string, `x-edge-request-id` string,
  `x-host-header` string, `cs-protocol` string, `cs-bytes` string, `time-taken` string,
  `x-forwarded-for` string, `ssl-protocol` string, `ssl-cipher` string,
  `x-edge-response-result-type` string, `cs-protocol-version` string, `fle-status` string,
  `fle-encrypted-fields` string, `c-port` string, `time-to-first-byte` string,
  `x-edge-detailed-result-type` string, `sc-content-type` string, `sc-content-len` string,
  `sc-range-start` string, `sc-range-end` string, `c-country` string)
PARTITIONED BY (distributionid string, year int, month int, day int, hour int)
ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
WITH SERDEPROPERTIES ('paths'='date,time,x-edge-location,sc-bytes,c-ip,cs-method,cs(Host),cs-uri-stem,sc-status,cs(Referer),cs(User-Agent),cs-uri-query,cs(Cookie),x-edge-result-type,x-edge-request-id,x-host-header,cs-protocol,cs-bytes,time-taken,x-forwarded-for,ssl-protocol,ssl-cipher,x-edge-response-result-type,cs-protocol-version,fle-status,fle-encrypted-fields,c-port,time-to-first-byte,x-edge-detailed-result-type,sc-content-type,sc-content-len,sc-range-start,sc-range-end,c-country')
STORED AS INPUTFORMAT  'org.apache.hadoop.mapred.TextInputFormat'
          OUTPUTFORMAT 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat'
LOCATION 's3://motodle-logs-051946164308/AWSLogs/051946164308/CloudFront/'
TBLPROPERTIES (
  'projection.enabled'='true',
  'projection.distributionid.type'='enum',
  'projection.distributionid.values'='E2YJHE1Q9IYIZW',
  'projection.year.type'='integer',  'projection.year.range'='2026,2027',
  'projection.month.type'='integer', 'projection.month.range'='01,12', 'projection.month.digits'='2',
  'projection.day.type'='integer',   'projection.day.range'='01,31',   'projection.day.digits'='2',
  'projection.hour.type'='integer',  'projection.hour.range'='00,23',  'projection.hour.digits'='2',
  'storage.location.template'='s3://motodle-logs-051946164308/AWSLogs/051946164308/CloudFront/${distributionid}/${year}/${month}/${day}/${hour}/');
```

Because `c-ip` and `x-forwarded-for` are not in `record_fields`, those two columns return `NULL`. **The honest unit of measurement is therefore "page loads" and "completions", not "unique visitors"** — which is the more useful pair for "did the launch land?" anyway `[analytics, "unique visitors"]`.

### Q1 — "Did the Reddit post work?" · page loads per venue per hour

```sql
SELECT "date", substr("time", 1, 2) AS hr,
       COALESCE(nullif(regexp_extract("cs-uri-query", '(^|&)r=([A-Za-z0-9_-]+)', 2), ''), '(none)') AS venue,
       count(*) AS page_loads
FROM motodle_cf_logs
WHERE year = 2026 AND month = 9 AND "cs-uri-stem" = '/'
  AND "sc-status" IN ('200', '304')
  AND lower("cs(user-agent)") NOT LIKE '%bot%'
  AND lower("cs(user-agent)") NOT LIKE '%crawl%'
  AND lower("cs(user-agent)") NOT LIKE '%spider%'
GROUP BY 1, 2, 3
ORDER BY 1, 2, 4 DESC;
```

### Q2 — referrer hosts, as a cross-check on Q1

```sql
SELECT url_extract_host("cs(referer)") AS host, count(*) AS page_loads
FROM motodle_cf_logs
WHERE year = 2026 AND month = 9 AND "cs-uri-stem" = '/' AND "cs(referer)" <> '-'
GROUP BY 1 ORDER BY 2 DESC LIMIT 25;
```

Expect this to *undercount* Reddit badly and to tell you nothing about which community: browsers default to `strict-origin-when-cross-origin`, so a click from Reddit sends at most `https://www.reddit.com/` — origin only, no subreddit, no post id — and Reddit's iOS/Android in-app browsers frequently send no `Referer` at all `[analytics, "Reddit's referrer behaviour"]`. **Q1's `?r=` is the real attribution; Q2 is the sanity check.** (Reddit's own referrer policy could not be read by any recon agent — flagged UNVERIFIED there; the origin-only conclusion follows from the browser default, not an observed Reddit header.)

### Q3 — "Do players finish?" · completion rate from logs alone, no beacon required

```sql
WITH loads AS (
  SELECT "date", count(*) AS n FROM motodle_cf_logs
  WHERE year = 2026 AND month = 9 AND "cs-uri-stem" = '/' AND "sc-status" IN ('200','304')
    AND lower("cs(user-agent)") NOT LIKE '%bot%' AND lower("cs(user-agent)") NOT LIKE '%crawl%'
    AND lower("cs(user-agent)") NOT LIKE '%spider%'
  GROUP BY 1
), finishes AS (
  SELECT "date", count(*) AS n FROM motodle_cf_logs
  WHERE year = 2026 AND month = 9 AND "cs-uri-stem" LIKE '/puzzles/img/%/full.webp'
  GROUP BY 1
)
SELECT l."date", l.n AS page_loads, COALESCE(f.n, 0) AS finished,
       round(100.0 * COALESCE(f.n, 0) / l.n, 1) AS completion_pct
FROM loads l LEFT JOIN finishes f ON f."date" = l."date"
ORDER BY 1;
```

`full.webp` is requested only by `ResultModal.svelte` at game end `[ops §1]`, so this counts rounds that reached a result screen — won, lost or given up alike. Name the unit honestly: it is **rounds reaching a result, per page load, practice rounds included** — `ArchiveList.svelte` navigates with `<a href="?d=<date>">`, so a practice round is a real page load and lands in both numerator and denominator. It is a proxy, not a count of people: a repeat visitor with the image already in browser cache is missed, and a full reveal reopened later is double counted.

### Q4 — the reveal funnel (where players drop out), also beacon-free

```sql
SELECT regexp_extract("cs-uri-stem", '/(l[1-5]|full)\.webp$', 1) AS step, count(*) AS n
FROM motodle_cf_logs
WHERE year = 2026 AND month = 9 AND "cs-uri-stem" LIKE '/puzzles/img/%.webp'
GROUP BY 1 ORDER BY 1;
```

### Q5 — outcomes and share rate (**requires the beacon**)

```sql
SELECT "date",
       count_if(regexp_like("cs-uri-query", '(^|&)e=w(&|$)')) AS won,
       count_if(regexp_like("cs-uri-query", '(^|&)e=l(&|$)')) AS lost,
       count_if(regexp_like("cs-uri-query", '(^|&)e=g(&|$)')) AS gave_up,
       count_if(regexp_like("cs-uri-query", '(^|&)e=s(&|$)')) AS shared
FROM motodle_cf_logs
WHERE year = 2026 AND month = 9 AND "cs-uri-stem" = '/assets/mtd.gif'
  AND regexp_like("cs-uri-query", '(^|&)p=0(&|$)')
GROUP BY 1 ORDER BY 1;
```

**Share *attempts* per finished round** = `shared / (won + lost + gave_up)`. `p=0` excludes practice rounds on **both** sides of the ratio — which is exactly why the share beacon must carry `p` (A.5); without it every `e=s` row is filtered out here and this column reads 0 forever. Call it "attempts", not "share rate": `handleShare()` fires the beacon before the share resolves and is bound on two modals, so one player can contribute several `e=s` rows for one round and **this ratio can legitimately exceed 100%** (see D13).

### Q6 — completion by venue (**requires the beacon**)

```sql
SELECT COALESCE(url_extract_parameter(url_decode("cs(referer)"), 'r'), '(none)') AS venue,
       count_if(regexp_like("cs-uri-query", '(^|&)e=[wlg](&|$)')) AS finished,
       count_if(regexp_like("cs-uri-query", '(^|&)e=s(&|$)'))     AS shared
FROM motodle_cf_logs
WHERE year = 2026 AND month = 9 AND "cs-uri-stem" = '/assets/mtd.gif'
GROUP BY 1 ORDER BY 2 DESC;
```

Subject to the A.5 attribution limitation — a floor, not a census. **`url_decode` first, deliberately:** CloudFront URI-encodes log field values, so `https://playmotodle.com/?r=wg` can arrive as `…%3Fr=wg` and a raw `regexp_extract('[?&]r=…')` would silently miss every such row. `url_extract_parameter(url_decode(…), 'r')` is immune to the encoding.

### Q7 — geography, and error rate as a runway/outage cross-check

```sql
SELECT "c-country", count(*) FROM motodle_cf_logs
WHERE year = 2026 AND month = 9 AND "cs-uri-stem" = '/' GROUP BY 1 ORDER BY 2 DESC LIMIT 25;

SELECT "date", "cs-uri-stem", "sc-status", count(*) FROM motodle_cf_logs
WHERE year = 2026 AND month = 9 AND "sc-status" LIKE '4%' GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 25;
```

Every one of these queries scans one month of partitions at most; at this site's volumes each costs between $0.00005 and $0.09 `[analytics §b]`. Add `AND day = <n>` for a single-day query and it scans 1/30th.

## A.7 Privacy statement — exact text, and where it goes

Lives in `/home/chris/workspace/motodle/public/about.html` (workstream B4) under `<h2 id="privacy">Privacy</h2>`, verbatim:

> Motodle has no accounts, no cookies, no third-party trackers and no third-party scripts. Your guesses, statistics and settings are stored only in your own browser. Two things do leave your device: the CDN that serves this site keeps an access log of the requests it receives — the page requested, its query string, the referring site, the browser's user-agent and the country — for 90 days; and when you finish or share a round the game fetches a tiny image whose address carries the puzzle number, whether you won, lost or gave up, which guess you finished on, your score, and whether it was a practice round. Nothing in either is tied to you: visitor IP addresses are excluded from the log, and no identifier of any kind is sent or stored.

**The earlier draft of this paragraph was false, and is not to be resurrected.** It said game statistics "are never sent anywhere" and then described the beacon as recording "only the outcome and the puzzle number" — but `BeaconParams` (A.5) carries `n`, `q` (the guess you finished on), `s` (score 0–15) and `p` (practice flag), and score and guess-count *are* game statistics. That is a false privacy notice on the page a Reddit thread points at, which is the exact failure mode this section exists to prevent. It also claimed "nothing here identifies you", which over-claims: `record_fields` retains `cs(User-Agent)`, `c-country` and second-resolution timestamps — a quasi-identifier even with `c-ip` gone. The text above enumerates the beacon's fields one by one and claims only the narrower, true thing: that no identifier is sent or stored.

Four sentences. Each is verifiable against the shipped stack: no cookies/third-party scripts (CSP `default-src 'none'`, `script-src 'self'`); localStorage-only game state (`src/lib/storage.ts`); the beacon's typed `BeaconParams` (A.5), field for field; the `record_fields` list in `infra/logs.tf`, from which `c-ip`, `x-forwarded-for` **and `x-edge-location`** are all absent; the 90-day `aws_s3_bucket_lifecycle_configuration`.

**Two conditional rewrites, both mandatory if the corresponding decision changes.** (a) If operator decision D1 drops the beacon, delete everything from "; and when you finish or share a round" to the end of that sentence, and change "Two things do leave your device:" to "One thing does leave your device:". (b) If decision D2 keeps `c-ip`, replace the final sentence with "That log includes the visitor's IP address, kept for 90 days and used only to count visits." **Do not ship "visitor IP addresses are excluded" with `c-ip` enabled, and do not ship "no trackers" unqualified with the beacon enabled** — anyone with devtools open sees `mtd.gif?e=w&n=42…` and will post a screenshot of it in the launch thread. Disclosing it in one clause costs nothing; being caught not disclosing it costs the launch.

---

# B. Launch checklist

Eleven workstreams. **B1 must land in the same push to `main` as B2, B3 and B4's root files** — see B1.

---

## B1 — Deploy plumbing for root-level static files (PREREQUISITE)

**Why this is first and why it is not optional.** `.github/workflows/deploy.yml` runs a cache-class assertion that hard-fails on any built file that is not under `assets/`, not a `puzzles/img/*.webp`, not `*.json` and not `*.html` `[repo-readiness §2]`. `robots.txt`, `sitemap.xml` and `og.png` are all three of those things. Recon reproduced the failure against a copy of the real `dist/`: all six test files were printed as unmatched and the step exited 1, **before any AWS credential is minted** `[repo-readiness §2]`. CI does not run this assertion and `npm run build` does not either — so CI stays green and the *post-merge deploy* is what breaks. PLAN §13.8 files robots/sitemap/OG under "content decisions, not deploy plumbing"; **that is wrong, and this workstream is the correction** `[repo-readiness, Risks]`, `[ops §7 M1]`.

**Ordering constraint, load-bearing.** `deploy.yml:3-4` records that the `workflow_run` trigger reads `deploy.yml` **from the default branch**. A push that adds `public/robots.txt` before the widened assertion has landed on `main` fails the deploy. **B1 and the files it admits must be one push to `main`.**

**A second ordering constraint, on the same mechanism — OPERATOR ACTION.** If B7(b)'s smoke test ships too, **the operator must `terraform apply` B7(a′)'s `cloudfront:GetInvalidation` IAM change BEFORE the commit carrying B7(b) reaches `main`.** `deploy.yml` is read from the default branch, so the very first post-merge deploy is otherwise red on an `AccessDenied` from `aws cloudfront wait`. B7(b) additionally depends on **B1 edit 3**, which is where `id: invalidate` and the `$GITHUB_OUTPUT` line are introduced; without edit 3, `${{ steps.invalidate.outputs.id }}` expands to empty and `aws cloudfront wait --id ""` fails.

**Files**
- `.github/workflows/deploy.yml` — four edits.

**Exact strings.**

Edit 1 — in the step named `Assert every built file falls into a known cache class`, replace the `find` invocation with:

```bash
          unmatched=$(cd dist && find . -type f \
            ! -path './assets/*' \
            ! -path './puzzles/img/*.webp' \
            ! -name '*.json' \
            ! -name '*.html' \
            ! -path './robots.txt' \
            ! -path './sitemap.xml' \
            ! -path './og.png' -print)
```

(`-path` and not `-name`: these three are admitted **only at the site root**, so a stray `og.png` inside `puzzles/` still fails the build.)

Edit 2 — insert three new steps between `Sync E: catalog, manifest and puzzle JSON` and `Sync F: index.html and 404.html`. Three passes rather than one, because each needs its own `--content-type` (`aws s3 sync` applies one content type per invocation):

```yaml
      # ---- Pass E2-E4: root static files. Before Pass F, so index.html never references a
      #      social image that is not in the bucket yet. ----
      - name: 'Sync E2: robots.txt'
        run: |
          aws s3 sync dist/ "s3://$SITE_BUCKET/" --no-progress \
            --exclude "*" --include "robots.txt" \
            --content-type "text/plain; charset=utf-8" \
            --cache-control "public, max-age=3600"

      - name: 'Sync E3: sitemap.xml'
        run: |
          aws s3 sync dist/ "s3://$SITE_BUCKET/" --no-progress \
            --exclude "*" --include "sitemap.xml" \
            --content-type "application/xml; charset=utf-8" \
            --cache-control "public, max-age=3600"

      - name: 'Sync E4: social image'
        run: |
          aws s3 sync dist/ "s3://$SITE_BUCKET/" --no-progress \
            --exclude "*" --include "og.png" \
            --content-type "image/png" \
            --cache-control "public, max-age=86400"
```

Edit 3 — replace the invalidation step's path list. The list is about to grow from 5 paths to 9 (`/robots.txt`, `/sitemap.xml`, `/og.png`, `/about.html`), so collapse it instead:

```yaml
      - name: Invalidate the mutable paths
        id: invalidate
        run: |
          set -euo pipefail
          id=$(aws cloudfront create-invalidation \
            --distribution-id "$DISTRIBUTION_ID" \
            --paths "/*" \
            --query 'Invalidation.Id' --output text)
          echo "id=$id" >> "$GITHUB_OUTPUT"
          echo "::notice::invalidation $id"
```

(The `id:` and the `$GITHUB_OUTPUT` line exist so B7's smoke test can *wait* for this invalidation rather than sleeping. If B7 is not implemented, the plain `create-invalidation` call above is enough.)

Rationale: a wildcard path counts as **one** path regardless of how many objects it matches, and the free allowance is the first 1,000 invalidation paths per month per account `[ops §2]`. 1 path/deploy → 1,000 deploys/month free, against 200/month with the old 5-path list and ~111/month with a 9-path list. The one thing `/*` widens over `/puzzles/*` is that it also evicts `/assets/*` — but those are content-hashed, so evicting them costs at most one origin fetch each per PoP, and `/puzzles/*` **already** evicts every "immutable" puzzle image on every deploy today `[ops §2]`, so the operational character does not change.

Edit 4 — the `Sync C: any other hashed asset` step's comment (`.github/workflows/deploy.yml:123`) currently begins "Empty today." That stops being true the moment A.4's `public/assets/mtd.gif` ships: Sync C is the pass that uploads it. Replace the comment:

```yaml
      # Carries the analytics beacon pixel (assets/mtd.gif) and nothing else today. Content type is
      # guessed from the extension (.gif, .svg, .woff2, .png all correct).
```

**Cache class the root files actually land in.** None of `/robots.txt`, `/sitemap.xml`, `/og.png`, `/about.html` matches an `ordered_cache_behavior` in `infra/cloudfront.tf`, so all four fall to `default_cache_behavior` → `aws_cloudfront_cache_policy.html` (`min_ttl 0`, `default_ttl 0`, `max_ttl 300`) `[repo-readiness §2]`. The origin `Cache-Control` reaches the browser intact; the **edge** TTL is clamped to 300 s. That is fine — these are scraped rarely and this avoids five more Terraform blocks and five more `function_association` copies. The response-headers policy (CSP, HSTS, nosniff, DENY, Referrer-Policy) is attached to the default behaviour, so all four are served with the full header set `[repo-readiness §2]`.

**Tests to update.** None — no test reads `deploy.yml`. `tools/check-budget.ts` measures only `dist/assets/*.{js,css}`, `dist/catalog.json` and per-puzzle payloads, so root files count against no budget `[repo-readiness §4]`.

**Definition of done.** `npm run build` succeeds; running the widened `find` by hand against `dist/` prints nothing; the push to `main` that carries B1 + B2 + B3 + B4 produces a green `deploy.yml` run.

**Verify live.**
```bash
for p in robots.txt sitemap.xml og.png about.html; do
  curl -sI "https://playmotodle.com/$p" | sed -n '1p;/^content-type/Ip;/^cache-control/Ip'
done
```

---

## B2 — Head metadata + OG image

**How the image is produced deterministically.** A committed SVG rendered to PNG by the `sharp` devDependency that `package.json` already carries (`"sharp": "^0.35.4"`). **The SVG contains no `<text>` element** — every glyph would otherwise be resolved against whatever fonts happen to exist on the rendering machine, which is not deterministic across the operator's laptop, CI and any future contributor. The card is therefore pure geometry: the favicon's ink plate and petrol chevron scaled up, plus a row of three rounded rects in the tile colours. Platforms render `og:title` and `og:description` as text beside the image anyway, so the card carries no words.

**Files**
- `tools/og/og.svg` — **new.** 1200×630 viewBox, paths and rects only, no `<text>`, no external refs. Reuse the exact chevron path and colours already in `index.html`'s favicon data URI: plate `#15181d`, chevron `#0d6b8a` (`stroke-width` scaled), and the tile row using the app's green/yellow/red tokens.
- `tools/og.ts` — **new.** ~15 lines:
  ```ts
  import { readFile, writeFile } from 'node:fs/promises';
  import sharp from 'sharp';
  const svg = await readFile(new URL('./og/og.svg', import.meta.url));
  const png = await sharp(svg, { density: 144 })
    .resize(1200, 630, { fit: 'contain' })
    // MANDATORY. `fit: contain` pads with TRANSPARENCY, and Reddit, X and some Slack clients
    // composite alpha to black or white unpredictably -- the card then looks broken in the one
    // place it is ever seen. #15181d is the favicon's ink plate, so the card matches the mark.
    .flatten({ background: '#15181d' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(new URL('../public/og.png', import.meta.url), png);
  ```
- `package.json` — add `"og": "tsx tools/og.ts"` to `scripts` (anchor on the `"crop"` line; **do not trust line numbers — `package.json` shifted during recon** `[repo-readiness, Risks]`).
- `public/og.png` — **new, committed.** 1200×630 (the size every platform's large-summary card expects).
- `tools/og.test.ts` — **new.** See "tests" below.
- `index.html` — new head tags.

**Exact head additions**, inserted after the existing `<meta name="referrer" …>` line and before the `theme-color` pair:

```html
    <link rel="canonical" href="https://playmotodle.com/">
    <meta name="author" content="Chris Wallace">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Motodle">
    <meta property="og:title" content="Motodle — guess the motorbike in 5 tries">
    <meta property="og:description" content="A new motorbike every day. The photo zooms out with each wrong guess.">
    <meta property="og:url" content="https://playmotodle.com/">
    <meta property="og:image" content="https://playmotodle.com/og.png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="The Motodle chevron mark above a row of green, yellow and red tiles.">
    <meta name="twitter:card" content="summary_large_image">
```

Absolute URLs are required: several scrapers do not resolve relative `og:image`. `og:url` and `canonical` are the bare apex so that a `?r=` landing still de-duplicates to one canonical page.

**Do NOT add** `<link rel="manifest">`: `manifest-src` is not in the CSP, so it falls through to `default-src 'none'` and would be blocked — and would surface as a `securitypolicyviolation` failing `e2e/csp.spec.ts` `[repo-readiness §1]`. A web app manifest is out of scope for launch.

**Tests to update.**
- `tools/og.test.ts` — **new.** Asserts `public/og.png` exists, `sharp('public/og.png').metadata()` returns `{ width: 1200, height: 630, format: 'png' }`, **`metadata().hasAlpha === false`** — the gate on the `.flatten()` above, and the only automated way to catch the one failure mode that passes every other check — and the file is under 100 KB. Deliberately **not** a byte-for-byte gate: librsvg/libvips output drifts across versions and a byte gate would fail CI on an unrelated `sharp` bump, for a file nothing depends on byte-exactly. `vite.config.ts`'s vitest `include` already covers `tools/**/*.test.ts`.
- `e2e/csp.spec.ts` — no change needed (nothing new is fetched by the page), but re-run it: it collects `securitypolicyviolation`, console errors, `pageerror` and ≥500 responses across a full round `[repo-readiness §9]`.
- **No existing test reads `document.title`, `<meta name="description">`, `theme-color` or the favicon** `[repo-readiness §9]`, so nothing breaks. `e2e/mobile-layout.spec.ts` pins only the *viewport* meta string — do not touch that line.

**Definition of done.** `npm run og` regenerates a byte-similar `public/og.png`; `npm test` green; `npm run build && npm run test:e2e` green; the built `dist/og.png` is present and the widened B1 assertion passes.

**Verify live.**
```bash
curl -s https://playmotodle.com/ | grep -E 'og:(title|image|url)|twitter:card|rel="canonical"'
curl -sI https://playmotodle.com/og.png | sed -n '1p;/^content-type/Ip;/^content-length/Ip'
# then paste https://playmotodle.com/ into a Discord DM to yourself and confirm the card renders
```

---

## B3 — robots.txt + sitemap.xml (and the F6 interaction)

**Files**
- `public/robots.txt` — **new**, exact contents:

```
User-agent: *
Allow: /

Sitemap: https://playmotodle.com/sitemap.xml
```

- `public/sitemap.xml` — **new**, exact contents (no `<lastmod>`: a static one goes stale the day after it is written, and it is optional in the sitemaps protocol):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://playmotodle.com/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>
  <url><loc>https://playmotodle.com/about.html</loc><changefreq>yearly</changefreq><priority>0.3</priority></url>
</urlset>
```

Only two URLs exist: the archive is `?d=<date>` on `/`, not a separate document, and `public/404.html` already carries `<meta name="robots" content="noindex">` `[repo-readiness §1]`.

**F6 interaction — and why this file carries no `Disallow` line at all.** The obvious draft was a `Disallow` of `/puzzles/` plus one of `/catalog.json`, sold as a free spoiler mitigation. **It is not free, and it does not mitigate.**

Google's renderer honours `robots.txt` for subresources and XHR. With `/puzzles/` and `/catalog.json` blocked, Googlebot fetches `/` but cannot fetch `catalog.json` or `puzzles/<today>.json`, so `applyPuzzleResult` lands on `load-failed`/`no-puzzle` (`src/state/game.svelte.ts` — `loadPuzzle` 404 or blocked → non-`ok`), and **the snapshot Google indexes is the "couldn't load" error screen** — while `sitemap.xml`, shipped in the same push, actively asks Google to index that page. Against that real cost the block buys nothing: the leak it is meant to cover is a direct `curl` (`curl /puzzles/manifest.json | jq -r .latest.date`, then `curl /puzzles/<that date>.json`), which `robots.txt` has never constrained, and a search engine will not surface an un-linked JSON file as a spoiler in any case. Exactly as PLAN §13.8 accepted `[ops §7 M0/M1]`, `[repo-readiness §10]`.

The `/catalog.json` line goes for the same reason: it is the complete make/model/year universe, not the answer, so blocking it trades a rendered index entry for 62 KB of saved crawl. **And deliberately no `Disallow` of `/assets/`** — it would hide nothing that matters (the beacon is first-party and disclosed on the About page) and would read, to anyone who looked, as a tracker being concealed.

`robots.txt` therefore constrains nothing, the OG scraper included (`og.png` is at the site root anyway). It ships for crawl hygiene and the `Sitemap:` pointer. **The whole F6 posture at launch is "accepted, unmitigated" — see B10.**

If the operator overrides this and insists on keeping the `/puzzles/` block, then B3 must state plainly that the indexed snapshot of `/` will show the "couldn't load" screen — and the `/catalog.json` line must be dropped either way.

**Tests to update.** None. Consider adding a two-line assertion to `e2e/csp.spec.ts` alongside the existing `/404.html` check (`[repo-readiness §9]`) that `/robots.txt` returns 200 — optional.

**Definition of done.** Both files land in the B1 push; deploy green; the widened assertion passes.

**Verify live.**
```bash
curl -s https://playmotodle.com/robots.txt
curl -s https://playmotodle.com/sitemap.xml | head -3
curl -sI https://playmotodle.com/sitemap.xml | sed -n '/^content-type/Ip'
```

---

## B4 — Copyright line, `about.html`, and the contact affordance

**The one-paragraph explanation of how © code/site coexists with MIT + CC/PD images.** Three distinct things are being licensed and the site must not blur them. (1) *The source code* is MIT — `LICENSE:3` already reads `Copyright (c) 2026 Chris Wallace`, and MIT is a grant Chris makes over code he wrote. (2) *The site as a compilation* — its wording, layout, puzzle selection, scheduling and the crops as a curated set — is Chris's original work and carries `© 2026 Chris Wallace`; a copyright notice asserts authorship of the parts he authored, it does not assert ownership of everything on the page. (3) *The photographs* are third-party works under their own Creative Commons or public-domain terms; they are **not** covered by either the MIT grant or the site's © line, and their licences travel with them — a CC BY-SA photo obliges a reuser to credit the photographer and share alike, regardless of anything Motodle says about its own code. The plan therefore places the © line **adjacent to, and never above,** the existing photo-credit sentence, and `about.html` states the split in words so the footer's brevity cannot be read as a claim over the photos. `docs/ATTRIBUTION.md` already carries this paragraph (`docs/ATTRIBUTION.md:6-12`, duplicated at `README.md:142-147`) but **is surfaced nowhere in the UI and is never deployed** `[repo-readiness §5]` — `about.html` is what fixes that.

**Files**
- `public/about.html` — **new.** Modelled on `public/404.html`: standalone document, self-contained inline `<style>` **element** (which is exactly what `style-src 'self' 'unsafe-inline'` already permits — 404.html is the only thing in the repo depending on that half of the directive `[repo-readiness §3]`), no external requests, no JS. **No `noindex`** — unlike 404.html, this page is meant to be indexed and is in the sitemap. A root `*.html` needs **no deploy change at all**: it passes today's cache-class assertion via `! -name '*.html'` and is uploaded by Sync F with `text/html; charset=utf-8` and the html cache class. Head: `<title>About — Motodle</title>`, the same charset/viewport/color-scheme metas as 404.html, plus `<link rel="canonical" href="https://playmotodle.com/about.html">`. Sections, in order: `<h1>About Motodle</h1>`; a short "what it is" paragraph; `<h2 id="privacy">Privacy</h2>` carrying **the A.7 text verbatim**; `<h2>Photos and licensing</h2>` carrying the three-part paragraph above, in prose, with a link to `https://commons.wikimedia.org/`; `<h2>Feedback</h2>` carrying the contact affordance; and a closing line `© 2026 Chris Wallace · <a href="/">Motodle</a>`.
- `src/App.svelte` — footer edit, below.
- `package.json` — set `"author": "Chris Wallace"`; add `"repository": { "type": "git", "url": "git+https://github.com/reenchree/motodle.git" }` and `"homepage": "https://playmotodle.com"`. Anchor on the existing `"author": ""` string, not a line number.
- `README.md` — see B5.
- `index.html` — `<meta name="author" content="Chris Wallace">` (already listed in B2).

**Exact footer change** in `src/App.svelte` (anchor on `<footer class="app-footer">`). The photo-credit line's *text* is unchanged, but be explicit that the snippet below **wraps it in a new `<div>` that does not exist today** — `src/App.svelte:193-200` has no inner `<div>`. That is a deliberate structural change, not a transcription slip, and it is harmless: `.app-footer` (`src/App.svelte:339-346`) is block-flow with `text-align: center`, no test asserts the footer's text, and `#mtd-credits-link` keeps its id. Add the second line beneath it:

```svelte
    <footer class="app-footer">
      <div>
        Photos: <a href="https://commons.wikimedia.org/" target="_blank" rel="noopener noreferrer"
          >Wikimedia Commons</a
        >, Creative Commons licenses ·
        <button type="button" id="mtd-credits-link" class="link-button" onclick={() => game.openCredits()}
          >Photo credits</button
        >
      </div>
      <div>© 2026 Chris Wallace · <a href="/about.html">About &amp; privacy</a></div>
    </footer>
```

`#mtd-credits-link` keeps its id and position — `e2e/playthrough.spec.ts:209-210` and `e2e/practice.spec.ts:101-102` click it, and `src/components/ResultModal.test.ts:135-144` pins the separate `#mtd-credits-link-result` `[repo-readiness §9]`. The `about.html` link is a plain same-origin `<a>` (no `target`, no `rel`), so it costs no JS and no CSP allowance. **One link, one page**, rather than separate "Privacy" and "Contact" links, so the footer grows by exactly one line.

**The load-bearing risk in this workstream.** No test asserts the footer's *text* `[repo-readiness §9]`, but `e2e/mobile-layout.spec.ts` asserts at 360×640 that the submit button's `getBoundingClientRect().bottom <= window.innerHeight` with `window.scrollY === 0` and no focus call, and that `scrollWidth <= clientWidth`. `.app-footer` has `margin-top: auto` in a flex column (`src/App.svelte:339-346`), so a second footer line can squeeze the column and push the submit button below the fold. **The e2e run is the gate, not a formality.** If it fails, apply this exact fallback to `.app-footer` and re-run:

```css
  .app-footer {
    margin-top: auto;
    padding-top: var(--space-2);   /* was var(--space-3) */
    border-top: 1px solid var(--color-border);
    font-size: 0.7rem;             /* was 0.75rem */
    line-height: 1.35;
    text-align: center;
    color: var(--color-muted);
  }
```

If it still fails, drop the `© 2026 Chris Wallace ·` prefix from the footer (it remains in `about.html`, `index.html`'s `author` meta, `package.json`, `README.md` and `LICENSE`) and keep only the `About & privacy` link — that is the minimum that satisfies F4's "coexists without misclaiming".

**Feedback / contact affordance.** There is none today: grepping all of `src/`, `index.html` and `public/404.html` for `mailto`, `contact`, `about`, `feedback`, `github.com` returns zero UI hits `[repo-readiness §5]`. Default recommendation: **a GitHub Issues link, no email address.** In `about.html`'s Feedback section:

```html
      <p>Found a wrong answer, a bad crop, or a bug?
        <a href="https://github.com/reenchree/motodle/issues">Open an issue on GitHub</a>.</p>
```

No personal email, because a `mailto:` on a page a Reddit thread points at is a spam magnet and the address cannot be rotated. **Sequencing constraint: this link 404s for anonymous visitors until the repo is public (B6).** Either land B4 and B6 together, or ship `about.html` at launch with the Feedback section's link omitted and add it in the same push as the flip. See operator decision D6.

**Tests to update.** `e2e/mobile-layout.spec.ts` — re-run, do not edit (unless the layout genuinely changed for a good reason). Optionally extend `e2e/csp.spec.ts`'s existing `/404.html` block with the same two assertions for `/about.html` (200, and the `<h1>` text renders) — recommended, it is four lines and it is the only automated proof the page ships.

**Definition of done.** `npm test`, `npm run check`, `npm run build`, `npm run test:e2e` all green (mobile-layout included); the footer shows two lines at 360×640 with the submit button still above the fold; `/about.html` renders standalone with no console errors under the production CSP.

**Verify live.**
```bash
curl -s https://playmotodle.com/about.html | grep -E '<title>|Privacy|Chris Wallace'
curl -sI https://playmotodle.com/about.html | sed -n '1p;/^content-security-policy/Ip'
curl -s https://playmotodle.com/ | grep -o 'meta name="author"[^>]*'
```

---

## B5 — README public-readiness

**Files:** `README.md` (plus, optionally, `LICENSE` — see the note below). **Anchor every edit on the quoted string, not a line number** — `README.md` and `package.json` were being edited during recon and every line number after 36 shifted `[repo-readiness, Risks]`.

| Find (string anchor) | Do |
|---|---|
| `This repo is private, so the badge image above only renders for viewers authenticated with repo access — it shows as broken in an anonymous or mirrored context. That's expected, not a config bug.` | **Delete the whole paragraph.** False the moment the repo is public. |
| `since the repo is private and a Wikimedia operator following a repo URL here would just get a 404` | Replace with `since the live site is the stable contact point for a Wikimedia operator following the user-agent string`. The premise disappears on the flip. `tools/lib/wikimedia.ts:24`'s `DEFAULT_UA_CONTACT` is asserted by `schema/validate.test.ts:66`, `tools/fetch.test.ts:355` and `tools/schedule.test.ts:82` — **do not change the constant**, only the README's explanation of it. |
| `## Status` … `This repo is being built in workstreams … All of W0-W5 have landed` | Rewrite as a two-line "Status: live at https://playmotodle.com since 2026-09-03." Reads as internal scaffolding otherwise. |
| `Only the three committed fixture dates (2026-09-02, 2026-09-03, 2026-09-04) have puzzle files` | Replace with a pointer, not a number: "The committed schedule runs to the `latest.date` in `public/puzzles/manifest.json`." Already going stale as the content batch lands. |
| the e2e spec table | Add the missing `e2e/csp.spec.ts` row `[repo-readiness §7]`. |
| `Code is MIT, see LICENSE; photos keep their own licences, see docs/ATTRIBUTION.md.` (`README.md:141`) | **Replace with exactly this, verbatim:** `© 2026 Chris Wallace. Everything in this repo except the photographs is licensed MIT (see LICENSE). The photographs are third-party Wikimedia Commons works under their own Creative Commons or public-domain terms, covered by neither the MIT grant nor that copyright line — see docs/ATTRIBUTION.md.` The earlier draft — which separated out the site's prose and layout as © while calling only the code MIT — read as a carve-out **contradicting `LICENSE:6`**, which grants MIT over "the Software and associated documentation files": the whole tree, markup and prose included. `README.md:138-147` and `docs/ATTRIBUTION.md:6-12` already carry the image carve-out, so this one-line summary is the only thing that changes. |
| the HCP Terraform paragraph (`execution mode local`) | Keep. It is accurate and useful; it discloses nothing an attacker can use. |

**Also add** a short "Analytics and privacy" section pointing at `/about.html` and stating that the site runs no third-party scripts and sets no cookies — the README is the first thing a Reddit commenter checks when a stranger's site asks them to click.

**Optional but recommended: put the same one-line scope note at the top of `LICENSE`.** GitHub's licence detector reads `LICENSE` and will label the public repo "MIT" for the whole tree, the CC BY-SA derivatives under `fixtures/images/` and `public/puzzles/img/` included. One sentence naming those two paths as excluded costs nothing and stops the badge asserting something false.

**Tests to update.** None.

**Definition of done.** No occurrence of `repo is private` remains: `grep -rn 'repo is private' README.md` returns nothing. `grep -c 'Chris Wallace' README.md` ≥ 1.

**Verify live.** N/A (not deployed). After B6: `curl -s https://raw.githubusercontent.com/reenchree/motodle/main/README.md | head -20`.

---

## B6 — Repo flip to public (OPERATOR ACTION)

Agents describe; **the operator performs every step**. Do these in order, all before the flip.

1. **Untrack `.claude/` — treat as a blocker, not a nicety.** `git ls-files .claude | wc -l` = **169** tracked files, including a vendored third-party "impeccable" skill declaring `license: Apache 2.0` and `.claude/skills/impeccable/scripts/modern-screenshot.umd.js`, a minified UMD bundle with **no licence header and zero occurrences of "MIT"/"license"/"copyright"** `[repo-readiness §7]`. Two problems: (a) the repo-root `LICENSE` nominally claims MIT over "the Software and associated documentation files" in this repo, which on the flip would sweep in Apache-2.0 and unlabelled third-party code — directly against F4; (b) `.claude/settings.json` installs `PostToolUse` and `Stop` hooks that execute `node .claude/skills/impeccable/scripts/hook.mjs`, so **anyone who clones the public repo and opens it in Claude Code runs that code**. Recommended:
   ```bash
   git rm -r --cached .claude
   printf '\n.claude/\n' >> .gitignore
   git commit -m "chore: untrack .claude/ ahead of making the repo public"
   ```
   This also cures the F1 "no third-party scripts" wording, which is true of what is *served* but was not true of what is *in the repo* `[repo-readiness, Risks]`. See operator decision D7 for the alternative.
2. **No address in the tree — and know that the tree is not the whole story.** `grep -rn '@' infra/*.tf` must find no email address; B7/B8's `alert_email` is a `sensitive` variable with **no default**, supplied via `TF_VAR_alert_email`. `git grep -n 'cbwcjw'` must return nothing. **But `git grep` scans tree contents only.** Also run:
   ```bash
   git log --format='%ae%n%ce' | sort -u
   ```
   The operator's address is on every commit's author *and* committer metadata. On the flip that becomes public, and it cannot be removed without a history rewrite. Record this as a **knowing decision, not an oversight** — alongside D7's note that untracking `.claude/` leaves its blobs reachable.
3. **Re-run the secret scan over `git rev-list --all` before the flip — do not inherit recon's.** The recon scan of all reachable blobs for `AKIA…`, `BEGIN … PRIVATE KEY`, `ghp_…` and `xox[baprs]-` matched **0 files** `[repo-readiness §7]`, but it recorded the history as **15** commits when the repo has **16** (`git rev-list --all --count` → 16, verified during critique). The scope claim is off by one, so re-run rather than trust it. Note step 1 does not rewrite history — the `.claude/` blobs stay reachable; see D7.
4. **Decide on the AWS account id.** `docs/PLAN.md` carries `051946164308` on **15** lines, including the OIDC provider ARN, the bucket name, the deploy role ARN, and a local filesystem path `/home/chris/workspace/motodle/.claude/skills/impeccable` `[repo-readiness §7]`. No IPs, no homelab hostnames, no email addresses. See operator decision D8 (default: leave).
5. **Flip:** `gh repo edit reenchree/motodle --visibility public --accept-visibility-change-consequences` (or the Settings → General → Danger Zone toggle).
6. **Immediately after:** confirm the CI badge renders anonymously, and confirm the `runway.yml` workflow from B9 is enabled (`gh workflow list`) — scheduled workflows behave differently on public repos (B9).
7. **Do not touch the deploy path.** The OIDC trust policy is `StringEquals` over `local.github_subs` = the legacy *and* immutable subject forms, built from `var.github_owner_id = 213154582` / `var.github_repository_id = 1355164768` (`infra/locals.tf`, `infra/iam.tf`) `[ops §9]` — visibility does not affect it.

**Adjacent finding, not blocking this launch.** `terraform-core`'s `GitHubOIDCECRPushRole` trusts `repo:reenchree/*:*` only. Live `gh api …/actions/oidc/customization/sub` shows `dyndns` and `maitre-d` still issue the **legacy** subject form, so **it is not broken today** — contradicting the memory note that says it will break on next use `[ops §9]`. It breaks for any newly created `reenchree` repo. Cheap forward-safe fix, at the operator's convenience: add `"repo:reenchree@213154582/*:*"` to that role's `values` list and apply in `terraform-core`. **Motodle is unaffected.**

**Definition of done.** `gh repo view reenchree/motodle --json visibility` returns `"public"`; `git ls-files .claude | wc -l` returns `0`; an anonymous `curl` of the README raw URL succeeds.

---

## B7 — Error and blank-page visibility

Four changes. **(a′) is an OPERATOR ACTION prerequisite for (b)**, and (a) and (b) are the ones that actually matter.

**(a′) Grant the deploy role `cloudfront:GetInvalidation` — OPERATOR ACTION, and it must land before (b) does.** Verified in `/home/chris/workspace/motodle/infra/iam.tf:51-56`: the `InvalidateThisDistribution` statement grants `actions = ["cloudfront:CreateInvalidation"]` and nothing else. `aws cloudfront wait invalidation-completed` polls `GetInvalidation` → `AccessDenied` → the step exits non-zero → **every deploy goes red**, on a step that runs *after* the bucket has already been mutated and invalidated. A permanently-red deploy that is not a deploy failure is precisely the alert fatigue B7 exists to prevent. In `data "aws_iam_policy_document" "deploy"`:

```hcl
  statement {
    sid       = "InvalidateThisDistribution"
    effect    = "Allow"
    actions   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
    resources = [aws_cloudfront_distribution.site.arn]
  }
```

Resource-level scoping on `aws_cloudfront_distribution.site.arn` works for both actions. **Ordering, load-bearing: the operator must `terraform apply` this BEFORE the commit carrying (b) reaches `main`** — `deploy.yml` is read from the default branch, so the first post-merge deploy is otherwise red. This is also recorded in B1's ordering note and in B7's DoD.

**(a) Stop the reaper race.** PLAN §13.8's own one-line fix, still unapplied `[ops §8]`. In `.github/workflows/deploy.yml`, `Sync G: delete objects no longer in the build`:

```yaml
          aws s3 sync dist/ "s3://$SITE_BUCKET/" --no-progress --delete --exclude "assets/*"
```

Today, pass G's unfiltered `--delete` can remove the previous hashed bundle while an edge PoP is still serving the previous `index.html` for up to ~60 s, so a viewer gets a hard 404 on `/assets/index-<oldhash>.js` — at module load, before `main.ts` runs, so the app cannot observe it and the user sees an empty `<div id="app">` `[repo-readiness §8]`, `[ops §8]`. The same failure runs backwards during a rollback. Cost of the fix: old bundles are never reaped, so `dist/assets` accumulates ~120 KB per deploy that changed the bundle — negligible, and vastly cheaper than a blank page during launch week. Update the `Sync G` comment to say the exclusion is deliberate.

**(b) A post-deploy smoke test. Prerequisites: B1 edit 3, and (a′) applied by the operator.** Add as the **last** step of `deploy.yml`, after the invalidation — and **in the same edit raise the job's timeout from 15 to `timeout-minutes: 30`**:

```yaml
      - name: Smoke test the deployed site
        run: |
          set -euo pipefail
          # Deterministic, not `sleep 20`: a slow propagation must not fail a deploy spuriously,
          # and that would happen during exactly the content pushes that matter most.
          # NON-FATAL by design: the waiter runs for minutes and a still-propagating invalidation
          # is not a broken deploy. Safe precisely because (a) stops reaping assets/*, so a stale
          # edge index.html still resolves its bundle.
          aws cloudfront wait invalidation-completed \
            --distribution-id "$DISTRIBUTION_ID" \
            --id "${{ steps.invalidate.outputs.id }}" \
            || echo "::warning::invalidation still in flight; smoke may see stale edge content"
          html=$(curl -fsS https://playmotodle.com/)
          # grep -om1, NOT `grep -o ... | head -1`: under `set -o pipefail` head closes the pipe and
          # grep dies on SIGPIPE, failing the step non-deterministically.
          bundle=$(printf '%s' "$html" | grep -om1 'assets/index-[A-Za-z0-9_-]*\.js')
          test -n "$bundle"
          curl -fsS -o /dev/null "https://playmotodle.com/$bundle"
          curl -fsS -o /dev/null https://playmotodle.com/catalog.json
          # TODAY's puzzle, never manifest.latest (~30 days out): only today answers the liveness
          # question, and today is M5-safe by construction -- a date gate never gates today.
          today=$(date -u +%F)
          curl -fsS -o /dev/null "https://playmotodle.com/puzzles/$today.json"
          echo "::notice::smoke ok — bundle=$bundle today=$today"
```

Zero infrastructure, and it catches the reaper race, a half-finished sync and a dead distribution on the spot: a failure fails the workflow run, and GitHub emails the operator through normal Actions notifications. There is no post-deploy check of any kind today `[ops §8]`.

**Four things this step gets wrong if written naively — all corrected above.**
1. **It must probe today, not `manifest.latest`.** `latest` is a puzzle roughly 30 days in the future: it answers no liveness question, and B10's held M5 date gate would 404 it and turn **every** deploy red. Today's date is the check that actually fails when the runway is exhausted. (The trailing `::notice::` must move to `today=$today` with it — under `set -u`, echoing an unset `$latest` fails the step.)
2. **`grep -o … | head -1` is the SIGPIPE footgun** already recorded in this operator's memory (`feedback_pipefail_grep_sigpipe`): `head` closes the pipe, `grep` dies on SIGPIPE, the step fails non-deterministically. `grep -om1` and no `head`. The regex itself is right — today's `dist/index.html` references `/assets/index-BNkWN0Qm.js`.
3. **The waiter can time the job out.** The two reviewers disagree on its arithmetic (30 attempts × 20 s ≈ 10 min, versus 30 s × 60 attempts ≈ 30 min). **It does not matter, because the waiter is now non-fatal** — and `timeout-minutes: 30` covers the worse of the two on top of checkout, `npm ci`, `vite build`, budgets and seven sync passes. A slow propagation must never cancel the job and paint a correct site red.
4. **`${{ steps.invalidate.outputs.id }}` does not exist without B1 edit 3.** Landing (b) alone expands it to empty and `aws cloudfront wait --id ""` fails.

**Rollback runbook — name it here, because a red smoke test means the site has *already* changed.** Re-running the workflow re-ships the same commit and fails the same way. The lever already exists: `deploy.yml`'s `workflow_dispatch` takes a `ref` input, and its header comment explains why a SHA input rather than `--ref <sha>`. **OPERATOR ACTION:**

```bash
gh workflow run deploy.yml --ref main -f ref=<last-good-sha>
```

`--ref main` is **mandatory** — the OIDC trust policy in `infra/iam.tf` admits only `refs/heads/main`, so a dispatch from any other ref cannot mint credentials.

**(c) CloudWatch alarms on the free CloudFront metrics.** `Requests`, `BytesDownloaded`, `4xxErrorRate`, `5xxErrorRate` and `TotalErrorRate` are published free for every distribution, into **us-east-1** `[ops §5]`. CloudWatch's always-free tier covers 10 alarm metrics `[ops §3]`, so two alarms cost **$0** provided the account is under that ceiling — **UNVERIFIED**, recon could not run `describe-alarms` (SSO expired). Do **not** enable CloudFront's eight "additional metrics" (cache hit ratio, per-status rates): they publish as custom metrics at up to ~$2.40/month per distribution and buy nothing here `[ops §5]`.

New file `/home/chris/workspace/motodle/infra/alarms.tf`. **`provider = aws.us_east_1` on every resource here** — CloudFront metrics live in us-east-1, and an alarm's action must target a topic in the alarm's own region (**the same-region-topic requirement is provider/AWS knowledge, UNVERIFIED by any recon report; prove it with a `terraform validate` plus one test notification — OPERATOR ACTION — before relying on it**). The implementer's gate on this file is `terraform fmt -check -diff /home/chris/workspace/motodle/infra`, and nothing more.

```hcl
resource "aws_sns_topic" "alerts" {
  provider = aws.us_east_1
  name     = "${var.name_prefix}-alerts"
}

# Email subscriptions require a click in the confirmation mail; terraform apply leaves this
# "pending confirmation" until the operator confirms. That is expected, not a failed apply.
resource "aws_sns_topic_subscription" "alerts_email" {
  provider  = aws.us_east_1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# 5xx is unambiguous: any sustained origin failure is real.
resource "aws_cloudwatch_metric_alarm" "cf_5xx" {
  provider            = aws.us_east_1
  alarm_name          = "${var.name_prefix}-cloudfront-5xx"
  namespace           = "AWS/CloudFront"
  metric_name         = "5xxErrorRate"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { DistributionId = aws_cloudfront_distribution.site.id, Region = "Global" }
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

# 4xx is the runway-exhaustion and OAC-loss signal: with no puzzle for today the app makes ~5
# requests of which 1 is a 404, so the rate jumps to 20-33% (ops recon 5). A BARE rate threshold
# false-alarms on a single overnight scanner, so gate it on a request floor with metric math.
#
# PERIOD IS 3600, NOT 300, AND THAT IS LOAD-BEARING. A 5-minute floor corresponds to ~3,000
# visits/day, so a 300s alarm would NEVER ARM at this site's traffic and the second runway
# detector in B9 would not exist at all.
#
# THE FLOOR IS 20, NOT 50. With the runway exhausted a cold visit is ~5 requests, so a floor of 50
# per hour is ~10 visits/hour, and evaluation_periods = 3 needs THREE CONSECUTIVE such hours --
# about 250-400 visits/day before this ever arms. A floor of 20 arms from roughly 100 visits/day
# sustained. Three consecutive hours, not the height of the floor, is what makes a single overnight
# scanner burst a non-issue.
#
# THRESHOLD IS 25, NOT 15, AND IT IS NOT AN HOURLY ERROR RATE. 4xxErrorRate is published PER
# MINUTE; `Average` over period 3600 is the unweighted mean of 60 per-minute rates, not the
# request-weighted hourly rate. One 404 in a quiet minute (1 request -> 100%) drags that mean up,
# and the IF() gate reads the hourly Sum so it does not suppress it. 25 absorbs the common case;
# the residual false-positive rate is ACCEPTED, not eliminated.
resource "aws_cloudwatch_metric_alarm" "cf_4xx" {
  provider            = aws.us_east_1
  alarm_name          = "${var.name_prefix}-cloudfront-4xx"
  evaluation_periods  = 3 # 3 hours of sustained breach before it pages
  threshold           = 25
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  metric_query {
    id          = "gated"
    expression  = "IF(reqs >= 20, rate4xx, 0)"
    label       = "4xxErrorRate when traffic is meaningful"
    return_data = true
  }
  metric_query {
    id = "rate4xx"
    metric {
      namespace   = "AWS/CloudFront"
      metric_name = "4xxErrorRate"
      stat        = "Average"
      period      = 3600
      dimensions  = { DistributionId = aws_cloudfront_distribution.site.id, Region = "Global" }
    }
  }
  metric_query {
    id = "reqs"
    metric {
      namespace   = "AWS/CloudFront"
      metric_name = "Requests"
      stat        = "Sum"
      period      = 3600
      dimensions  = { DistributionId = aws_cloudfront_distribution.site.id, Region = "Global" }
    }
  }
}
```

**One more false-fire path, worth knowing before the first page:** a 404ing `/assets/mtd.gif` — the beacon pixel never reached the bucket — inflates `4xxErrorRate` on exactly the traffic that makes this alarm arm, and reads identically to runway exhaustion. B11's pre-post gate curls that path for this reason.

Add to `infra/variables.tf`. **No `default`, deliberately** — this repo goes public (F3), and recon counted "no email addresses anywhere in the tree" as one of the flip's clean properties `[repo-readiness §7]`. Hard-coding the operator's address here would undo that:

```hcl
variable "alert_email" {
  description = "Address that receives budget and CloudWatch alarm notifications. Supplied via TF_VAR_alert_email; never committed."
  type        = string
  sensitive   = true
}
```

The HCP Terraform workspace runs in **local** execution mode (plan/apply on the operator's machine), so the value comes from the operator's shell — **OPERATOR ACTION**, since an implementer agent has neither the HCP token nor a live SSO session:

```bash
export TF_VAR_alert_email='<the address>'   # add to the shell profile, or a gitignored .envrc
terraform -chdir=/home/chris/workspace/motodle/infra plan
```

The implementer's gate on everything in B7 remains `terraform fmt -check -diff /home/chris/workspace/motodle/infra`.

An unset `TF_VAR_alert_email` makes Terraform prompt interactively rather than fail silently. **B6's pre-flip checklist must confirm `grep -rn '@' infra/*.tf` finds no address.**

**Deliberately no `Requests`-low alarm.** A "site went dark" alarm on a metric that is legitimately zero at 4am on a hobby site is a pager that cries wolf; B9's scheduled workflow does the liveness check instead, in one place, with a real HTTP GET. **State the consequence plainly rather than leaving it implied: with `treat_missing_data = "notBreaching"` on both alarms and no `Requests`-low alarm by design, a *total* outage — DNS gone, ACM renewal failed, distribution disabled — produces no CloudWatch signal at all.** B9's `curl` is the only detector for that class of failure. That is why B9 splits liveness into its own job, gives it retries, and runs every 6 hours rather than daily.

**What still has no signal, and why that is accepted.** A **CSP block** (an inline script, a new third-party origin) returns 200 on everything and is **completely invisible** at the edge; the only in-band signal would be a `report-to` endpoint, which needs a collector — a backend and a third-party origin in `connect-src` — breaking F1 twice over `[ops §5]`. The existing pre-merge control is the right one: `vite.config.ts` serves the exact production CSP from `schema/constants.ts` in `preview`, `schema/csp-contract.test.ts` pins it byte-for-byte against `infra/variables.tf`'s `default = "…"` line, and `e2e/csp.spec.ts` runs a full round under it. **Any workstream that changes the CSP must change all four places together** — `schema/constants.ts`, `infra/variables.tf`, and re-run the contract test and the e2e suite; the contract test's regex `/^\s*default\s*=\s*"([^"]*)"\s*$/m` accepts only a single-line double-quoted default, so a heredoc breaks it `[repo-readiness §3]`. **No workstream in this plan changes the CSP.**

**Tests to update.** None (`.tf` and workflow changes only). `schema/csp-contract.test.ts` must stay green, which it will, unchanged — **and here is *why*, so that no implementer panics at adding a `variable` block to a file a contract test reads:** the test splits `infra/variables.tf` on `^variable ` and matches only the `content_security_policy` block, so a new `variable "alert_email"` is invisible to it.

**Definition of done.** *Implementer gate:* `terraform fmt -check -diff /home/chris/workspace/motodle/infra` clean — and the HCL stays **unverified** until the operator plans. *Operator gates, all OPERATOR ACTION:* `terraform validate` and `terraform plan` clean in `infra/`; **(a′)'s `cloudfront:GetInvalidation` IAM change applied BEFORE the commit carrying (b) reaches `main`**; the SNS email subscription confirmed by clicking through the confirmation mail (an apply leaves it "pending confirmation" — expected, not a failed apply); and a deliberately broken smoke step (temporarily curl a nonexistent path in a scratch branch) fails the run — or, less invasively, confirm the smoke step's `::notice::` line in the first real deploy's log.

**Verify live.**
```bash
aws cloudwatch describe-alarms --alarm-name-prefix motodle --region us-east-1 \
  --query 'MetricAlarms[].[AlarmName,StateValue]' --output table
aws sns list-subscriptions-by-topic --region us-east-1 \
  --topic-arn "$(aws sns list-topics --region us-east-1 --query "Topics[?contains(TopicArn,'motodle-alerts')].TopicArn" --output text)" \
  --query 'Subscriptions[].[Protocol,SubscriptionArn]' --output table   # must not read "PendingConfirmation"
```

---

## B8 — Cost guardrail (AWS Budget)

**There is no budget, no billing alarm and no SNS topic anywhere in code today** — `grep -rniE 'budget|billing|aws_cloudwatch_metric_alarm|aws_sns_topic' --include='*.tf'` over `terraform-core` returns nothing, and `motodle/infra` has none either `[ops §3]`; independently re-verified during critique, along with `terraform-core/iam_github.tf:21`'s `"repo:reenchree/*:*"` (see B6's adjacent finding). A console-created budget cannot be ruled out (SSO expired during recon); `terraform plan` will say — **OPERATOR ACTION**.

**Files:** new `/home/chris/workspace/motodle/infra/budget.tf`.

**Scope decision:** account-wide, not service-filtered. A cost filter that names CloudFront/S3/Route53 would miss exactly the surprise — a service nobody expected — which is what a guardrail is for. `motodle/infra` owns it because motodle is the only thing in `051946164308` with public traffic; add a comment so a future `terraform-core` change does not create a duplicate.

```hcl
# infra/budget.tf
# Account-wide cost guardrail (F2). Deliberately NOT service-filtered: the point is to catch a
# surprise, and a filter would exclude the surprise by construction. OWNED BY THIS WORKSPACE --
# do not add a second account budget in terraform-core.
resource "aws_budgets_budget" "account_monthly" {
  name              = "${var.name_prefix}-account-monthly"
  budget_type       = "COST"
  limit_amount      = "10"
  limit_unit        = "USD"
  time_unit         = "MONTHLY"
  time_period_start = "2026-09-01_00:00"

  # ~$2: anything above four times today's ~$0.50 baseline is worth knowing about early.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 20
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
  # ~$6: the "this is really happening" line.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 60
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
  # Forecast to blow the $10 cap. Needs some billing history before AWS will forecast at all.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}
```

**Threshold rationale — and the single cost table for this whole document.** Measured from the live build, not estimated: `index.html` 738 B gzipped, `index-*.js` 31.1 KB gz, `index-*.css` 6.0 KB gz, `catalog.json` 7.3 KB gz, a puzzle JSON ~2.4 KB, the five reveal levels ~130–276 KB, `full.webp` 38–157 KB. So **a bounce ≈ 56 KB, a full playthrough ≈ 480 KB, and at ~40% completion the average visit is ~220 KB.** Everything else in this plan that quotes a cost defers to this table.

| Free-tier limit | Allowance | Binds at | Why |
|---|---|---|---|
| **CloudFront Functions** | 2M invocations/month | **~6,600 visits/day** | Binds **first**. `www_to_apex` is a `viewer-request` function on **all five** behaviours (`infra/cloudfront.tf`), so every viewer request — every image, and every beacon — is one invocation `[ops §1]`. |
| **Requests** | 10M/month | ~33,000 visits/day | ~11 requests on a full playthrough, 7 on a bounce `[ops §1]`. |
| **Data transfer out** | 1 TB/month | ~55,000 visits/day | At ~220 KB/visit. 100k visits/day is ~660 GB/month — still inside the free tier, which is why the "~$37/month at 100k visits/day" figure quoted elsewhere is **conservative**. |

Today's spend is ~$0.50/month (the Route53 zone); beyond free tier it is ~$3.00 per 100k visits `[ops §1]`.

**A $10 cap alerts at roughly 350k visits beyond free tier — comfortably above any plausible Reddit spike. But do not read that as "no mail during a successful launch."** AWS forecasts from month-to-date, so a single 30–50k-visit launch day early in the month projects well past $10 and the **FORECASTED** notification mails the operator *during a launch that is working*. Two options: expect that mail and treat it as informational, or move the FORECASTED threshold onto a second $25 budget and leave the $10 budget's two ACTUAL thresholds alone. **Default: expect the mail** — one informational email in launch week is cheaper than a second budget resource to maintain.

**Uncertainty, stated — and it is the operator who resolves it, not the implementer.** No recon report covers `aws_budgets_budget`; every argument above is from provider memory. **UNVERIFIED.** A reviewer did confirm against the pinned provider binary (`infra/.terraform/providers/registry.terraform.io/hashicorp/aws/5.100.0/linux_amd64/terraform-provider-aws_v5.100.0_x5`) that `aws_budgets_budget` — along with `aws_cloudwatch_log_delivery_source`, `aws_cloudwatch_log_delivery_destination`, `aws_cloudwatch_log_delivery`, `s3_delivery_configuration`, `suffix_path`, `enable_hive_compatible_path`, `record_fields`, `delivery_destination_configuration` and `destination_resource_arn` — is **present** in 5.100.0, so A.3's core claim holds. Present is not the same as valid. **The implementer's step 1 is `terraform fmt -check -diff /home/chris/workspace/motodle/infra`, and that is the only gate it can run:** `infra/backend.tf`'s `cloud {}` block means `init` needs an HCP token and `plan` needs a live AWS session. **OPERATOR ACTION:** run `terraform plan`; if `aws_budgets_budget` argument names are rejected, fix them against the **5.100.0** docs, not the v6 registry render. Budgets email directly (no SNS), so this costs $0. Whether `FORECASTED` notifications fire without billing history is **UNVERIFIED**; if AWS refuses to forecast for a young account, the two ACTUAL thresholds still work.

**Tests to update.** None.

**Definition of done.** *Implementer:* `terraform fmt -check -diff /home/chris/workspace/motodle/infra` clean. *Operator gate (OPERATOR ACTION):* `terraform plan` in `infra/` shows exactly one `aws_budgets_budget` to add and no other unexpected change — and if any argument name is rejected, it is fixed against the **5.100.0** provider docs, not the v6 registry render; after apply, the budget appears in Billing → Budgets with three alerts.

**Verify live.**
```bash
aws budgets describe-budgets --account-id 051946164308 \
  --query 'Budgets[].[BudgetName,BudgetLimit.Amount,TimeUnit]' --output table
```

---

## B9 — Content-runway alert (ONE pattern: scheduled GitHub Actions workflow)

**Pattern chosen: `[ops §4(i)]`, the scheduled workflow.** Rejected: `[ops §4(ii)]`, a Prometheus blackbox/json_exporter probe on sea-k3s — it needs a **new `json_exporter` HelmRelease that does not exist in `sea-k8s-flux`** plus a **new numeric field in `manifest.json`**, which means editing `Manifest` in `schema/types.ts`, `buildManifest` in `tools/lib/puzzle-build.ts:104-113`, the manifest contract test, and regenerating so CI's byte-identical gate stays green; and it produces **no alert at all while the home WAN is down** — the same gap already recorded for BLR `[ops §4]`. Blackbox alone cannot do it: its `fail_if_body_not_matches_regexp` is static config and cannot be compared against "today".

**Files:** new `/home/chris/workspace/motodle/.github/workflows/runway.yml`, complete:

```yaml
name: Content runway
on:
  schedule:
    # Not on the hour: "The schedule event can be delayed during periods of high loads ... High load
    # times include the start of every hour" -- and some queued jobs get dropped entirely.
    #
    # EVERY 6 HOURS, NOT DAILY. Still $0, still subject to the same 60-day auto-disable, but it cuts
    # the blind window on a TOTAL outage (DNS, ACM renewal, disabled distribution) from 24h to 6h --
    # and per B7(c) this curl is the ONLY detector for that class of failure.
    - cron: '17 */6 * * *'
  workflow_dispatch:
permissions:
  contents: read

# TWO JOBS, DELIBERATELY. GitHub's scheduled-workflow failure notification names the FAILED JOB.
# As steps of one job the email reads identically for "the site is DOWN" and "content is running
# OUT", and the operator has to open the run to tell which. Split, the subject line says it.
jobs:
  liveness:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - name: Site is answering
        run: |
          set -euo pipefail
          # --retry: a runner-side blip must not produce a false red. The FIRST false alarm is what
          # teaches an operator to ignore the mail, and this mail has no second channel.
          curl -fsS -o /dev/null --max-time 20 \
            --retry 3 --retry-delay 5 --retry-all-errors https://playmotodle.com/
          echo "::notice::playmotodle.com answered 2xx"

  runway:
    needs: liveness
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - name: Days of runway
        run: |
          set -euo pipefail
          # NOTE: PLAN 13.8's `jq -r .latest` prints a JSON OBJECT, not a date. `.latest.date` is
          # the working expression (ops recon 4).
          latest=$(curl -fsS --max-time 20 --retry 3 --retry-delay 5 --retry-all-errors \
            https://playmotodle.com/puzzles/manifest.json | jq -r '.latest.date')
          today=$(date -u +%F)
          days=$(( ( $(date -u -d "$latest" +%s) - $(date -u -d "$today" +%s) ) / 86400 ))
          echo "::notice::content runway: $days days (latest $latest)"
          if [ "$days" -lt 7 ]; then
            echo "::error::content runway is $days days (latest puzzle $latest) — schedule more puzzles"
            exit 1
          fi
```

**Exact contract and its caveats, all from `[ops §4]`:**
- **Threshold: fail below 7 days of runway.** The workflow reads `manifest.json` — **not** a future puzzle path — deliberately: if the F6 date gate (B10 / M5) is ever adopted, a gated future path would 404 and this check would misreport. `manifest.json` cannot be gated by a CloudFront Function (a Function cannot rewrite a response body).
- **Notification path:** "Notifications for scheduled workflows are sent to the user who last modified the cron syntax in the workflow file." So **the commit that lands the `cron:` line must be authored under the operator's own GitHub identity** for the failure email to reach him — which it is if it is committed and pushed from his machine with his configured `user.email`, even when an agent wrote the file. If an implementer agent's commit ends up attributed to anyone else, re-touch the `cron:` line in a commit the operator authors. There is no other notification channel.
- **Two jobs, and retries on both curls.** `jobs.liveness` and `jobs.runway` (`needs: liveness`) exist so the *failure email itself* says DOWN versus EXHAUSTED without the operator opening the run. `--retry 3 --retry-delay 5 --retry-all-errors` exists because the first false red is what trains an operator to ignore this mail, and there is no second notification channel.
- **Runs on the latest commit on the default branch.** Cost $0.
- **The 60-day auto-disable is the real hazard, and F3 activates it.** "In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days" — and only new commits count; the workflow's own runs do not reset the clock. The adversarial shape is exact: land a 90-day content batch, stop committing, and the runway alarm disables itself before the runway it watches runs out.
  **Mitigation, no extra machinery — but it is conditional twice over.** B7's `4xxErrorRate` alarm independently detects runway exhaustion: with no puzzle for today, a cold first visit makes ~5 requests of which 1 is a 404 (20%), and a repeat visitor ~3 of which 1 is a 404 (~33%) `[ops §5]`.
  **First condition — the traffic mix. At `threshold = 25` a purely cold-traffic hour (20%) does NOT breach.** The detector leans on the repeat-visitor mix (~33%) and on the per-minute-`Average` quirk IM7 flagged, which pushes the hourly mean *up* on quiet minutes. That quirk is a false-positive source at 15 and is, at 25, the thing keeping this detector alive at all — so do not "fix" it either. A launch-day audience that bounces once each and never returns is the case this alarm misses.
  **Second condition — the traffic volume. The honest arming figure is roughly 100 visits/day sustained** — not "roughly 120", and not any figure derived without `evaluation_periods`. The gate is `reqs >= 20` per hour (about 4 visits/hour once the runway is out) and `evaluation_periods = 3` needs **three consecutive** such hours. At the original `reqs >= 50` the same arithmetic came to ~250–400 visits/day, which is why the floor was lowered.
  **So the "two unrelated detectors" claim holds only above that traffic, and only with returning players in the mix.** If the launch flops — an outcome C.6 explicitly plans for — the 4xx alarm never arms, and the auto-disabling `runway.yml` is the *only* detector: exactly the failure mode this mitigation is supposed to have removed. **Therefore the monthly `gh workflow list` check is not optional at low traffic**; after the flip, check it monthly and re-enable with `gh workflow enable runway.yml`.
  Two further conditions on the AWS detector: it must stay at `period = 3600` (at 300 s the floor corresponds to ~3,000 visits/day and it would never arm at all), and if an implementer "simplifies" B7c's periods this mitigation silently disappears.

**Tests to update.** None.

**Definition of done.** `gh workflow run runway.yml && gh run watch` succeeds and the run log shows the `::notice::` line from **each of the two jobs** (`liveness`, then `runway`) with a plausible day count; deliberately lowering the threshold to a number above the real runway makes the **`runway` job — and only that job — fail red** (revert after). That per-job failure is the entire point of the split.

**Verify live.**
```bash
curl -s https://playmotodle.com/puzzles/manifest.json | jq -r '.latest.date'
gh workflow list --repo reenchree/motodle | grep -i runway
gh run list --workflow runway.yml --limit 5
```

---

## B10 — The F6 decision: future puzzles are readable before their date

**What is exposed today, precisely.** `public/puzzles/manifest.json` publishes `"latest": {"date":"…","number":N}` and the full `puzzles[]` list; `public/puzzles/<future date>.json` carries `"answer": {"makeId":…,"make":…,"modelId":…,"model":…,"year":…}` in plaintext, plus the image paths; images are keyed by puzzle **number** (`img/0003/`), not a content hash, and future-dated images are uploaded in the same deploy `[repo-readiness §10]`. The client never requests a future date (`game.svelte.ts:199` refuses `puzzleNumber(target) < 1`, and a future `?d=` is stripped), so the exposure is purely direct-URL: **two curls.** PLAN §13.8 accepts this explicitly.

**Decision: the exposure stands at launch with no mitigation shipped (PLAN §13.8's position, unchanged); M5 is specified and held.** Rationale, in order of weight:

1. **`robots.txt` is not a mitigation and is no longer presented as one.** An earlier draft shipped a `Disallow` of `/puzzles/` as "the whole mitigation". It closes nothing — the leak is a direct `curl`, which `robots.txt` has never constrained — and it *costs*: Google's renderer honours `robots.txt` for subresources, so blocking `/puzzles/` and `/catalog.json` makes the indexed snapshot of `/` the "couldn't load" error screen, while `sitemap.xml` in the same push asks Google to index that page. See B3. The file ships as `Allow: /`.
2. **The only mitigation that actually closes the two-curl leak is M5** — a date gate merged into the CloudFront Function — and **M5 sits in the viewer-request path of every single request to the site** `[ops §7]`. A bug in it takes the whole site down. Launch week is precisely the wrong time to put a new branch in that path.
3. **M2 alone is near-worthless.** Clamping `latest` and trimming future entries removes a *discovery* mechanism, but the URL scheme is `/puzzles/YYYY-MM-DD.json` and tomorrow's date is not a secret. Anyone motivated enough to curl the manifest is motivated enough to type tomorrow's date. Trimming also breaks `tools/check-budget.ts`'s manifest↔`dist/` equality assertion unless applied to both, and a trim that depends on "today" cannot live in `public/` at all because `ci.yml` diffs the committed tree byte-for-byte `[ops §7 M2]`. Removing `latest` outright breaks Archive and Credits via `isManifestShaped()` `[ops §7]`.
4. **The consequence is bounded and community-moderated.** The strongest norm in every venue in §C is that the current day's answer must not appear in a thread at all — r/wordle's rule 1 forbids revealing anything about the current puzzle "in any time zone—EVEN IF YOU USE SPOILER TAGS", minimum three-day ban; r/puzzles auto-removes untagged top-level guesses `[community §5, R10]`. A spoiler post is a moderation problem, not a site outage.

**M5, fully specified and HELD.** If someone does post tomorrow's answer, this is ready to apply in a change window — not on launch day. `[ops §7 M5]`:
- **Merge into the existing `aws_cloudfront_function "www_to_apex"` code block in `infra/cloudfront.tf`.** Only one `viewer-request` function may be associated per behaviour and `www_to_apex` already occupies that slot on all five; a second function is not attachable, and renaming the resource forces a replace.
- Gate both `/puzzles/YYYY-MM-DD.json` (date is in the URI) and `/puzzles/img/NNNN/*` (number → date via `LAUNCH_DATE = '2026-09-02'` + (N−1) days). Pure arithmetic — Functions have no network and no filesystem, but a working `Date`.
- Cutoff `Date.now() + 14*3600*1000`: UTC+14 (Kiritimati) is the earliest zone, so no legitimately-playing viewer is ever blocked and the leak shrinks to ≤14 hours.
- **Return 404, never 403.** `loadPuzzle()` maps 404 → `no-puzzle` (the friendly "check back tomorrow" screen) and any other non-ok → `load-failed` (the error screen); 404 also matches the existing S3-403→404 mapping.
- **It does not fix the manifest.** A Function cannot rewrite a response body, so the *schedule* stays visible even when the *answers* do not. Pair with M2 if that matters.
- **Untested by CI.** `vite preview` and Playwright do not execute CloudFront Functions, so e2e neither covers nor is broken by it. Requires its own `aws cloudfront test-function` run and a §13.7-style curl row before publish, plus a re-check of B9's runway workflow (it already reads `manifest.json`, so it is safe by construction).
- **UNVERIFIED and must be checked first:** whether a Function-generated 404 carries `aws_cloudfront_response_headers_policy.site` (CSP, HSTS, nosniff, DENY, Referrer-Policy). If it does not, M5's 404s ship without the headers that §13.7's verification matrix asserts on every path class `[ops, Risks]`.

**Also rejected:** M3 (build-time filter shipping only ≤ today+1) — it conflicts head-on with deploy-on-push, so a quiet week ships nothing and the site goes dark; and M4 (scheduled daily deploy) — it adds no leak reduction over M5, inherits the same 60-day auto-disable, and changes the posture from "deploys when I push" to "deploys itself" `[ops §7]`.

**Files:** none. B3's `robots.txt` ships for crawl hygiene and the `Sitemap:` pointer, not as an F6 control.
**Tests to update:** none.
**Definition of done:** `curl -s https://playmotodle.com/robots.txt` returns `Allow: /` and **no `Disallow` line at all**; a fetch of `/` under a crawler user-agent still renders the game rather than the "couldn't load" screen.
**Verify live:** `curl -s https://playmotodle.com/puzzles/manifest.json | jq -r '.latest.date'` still returns a date (the leak is *known and accepted*, so the check is that nothing broke, not that it is gone).

---

## B11 — Pre-post gate (run this before any §C post)

Not a code workstream; a checklist the operator runs in one sitting.

```bash
# 1. Runway is at least 30 days past today.
curl -s https://playmotodle.com/puzzles/manifest.json | jq -r '.latest.date'

# 2. The site is whole.
curl -sI https://playmotodle.com/ | sed -n '1p;/^content-security-policy/Ip'
curl -s  https://playmotodle.com/ | grep -c 'og:image'
curl -sI https://playmotodle.com/og.png | sed -n '1p'
curl -s  https://playmotodle.com/robots.txt        # expect `Allow: /` and NO Disallow line

# 3. The beacon pixel actually reached the bucket. NOTHING else ever exercises this path: the
#    location.hostname guard (correctly) makes the beacon inert under `vite preview`, so neither
#    e2e/csp.spec.ts nor Playwright fetches it. A 404 here is indistinguishable from "nobody
#    shared" in Q5/Q6 -- and it inflates 4xxErrorRate, which can false-fire B7c's runway detector.
curl -sI "https://playmotodle.com/assets/mtd.gif?e=w&n=1&c=test" | sed -n '1p;/^content-type/Ip;/^cache-control/Ip'
#    expect: 200, image/gif, public, max-age=31536000, immutable

# 4. The card renders: paste https://playmotodle.com/?r=test into a Discord DM to yourself.
# 5. Play one full round on a real phone (PLAN 7.5 row 10 keeps this a manual gate).
# 6. Repo is public and the README no longer says it is private.
gh repo view reenchree/motodle --json visibility
```

**One further OPERATOR ACTION before the first post — the only end-to-end proof the beacon works.** Play one *real* (non-practice) round to completion, then run Q5 (A.6) restricted to that date and confirm a non-zero row. Step 3 proves the pixel is *reachable*; only this proves it is *fired and logged*. Allow for the ~4 h standard-logging delivery lag before expecting the row, and do this during the 24 h baseline window C.6 requires anyway.

Plus the three competitor re-checks from `[community §8]`: **motoguesser.com** (404 with a "This app isn't live yet" placeholder as of 2026-09-03, but its indexed marketing copy — "guess the motorcycle in 5 tries… new motorcycle challenge every day" — is near-identical to Motodle's own description; a near-copy going live in launch week is a live risk), **throttleiq.app** (live, pixelated motorcycle guessing), **motordle.com** (live, vehicles with year-range hints).

---

# C. Community playbook

**A structural fact that shapes everything below.** Motodle has **no global rollover**. `todayKey()` is built from the viewer's **local** calendar date and the rollover watcher fires at each player's local midnight `[community §6]`. Consequences: (a) posting time cannot be tuned to "just after the new puzzle drops" because there is no drop moment — only the audience's clock; (b) a thread that stays alive across a UTC day boundary will contain share grids with **two different `#N`**, and someone will call that a bug — have the one-line answer ready (below); (c) every visitor at any hour gets an unplayed puzzle, which is strictly better for a launch than a global reset.

**Rules discipline — read this before quoting any rule.** Every Reddit rule quoted below comes from an Internet Archive capture, not a live read: reddit.com, old.reddit.com, api.reddit.com and five proxy/mirror routes all refuse automated access `[community §0, R1]`. Capture dates are given. **The operator must re-read each subreddit's rules in a browser immediately before posting** — carry the URLs, not the quotes, as the operative artifact. Also: `submission_type` (link vs text vs any) lives only in `about.json`, which was unreachable, so every "link post" below is *inferred from rule text* `[community R2]`.

## C.1 Venues, in order

| # | Venue | The quoted rule that permits the post | Format | `?r=` code |
|---|---|---|---|---|
| 1 | **r/WebGames** (capture 2026-08-01) | Rule 0: *"your post must be to a **web** game - a game playable in a web browser"*; rule 3: *"The post must link as directly to the game as possible."* No self-promotion prohibition exists in its rules — the sub exists for sharing browser games, and the sidebar has a **"Submit a Game"** button `[community §1.1]` | **Link post.** Rule 2: *"The first words of your post title **must** be that of the game's name."* Rule 4: no sign-ups (Motodle complies). Rule 7: *"Accounts must be at least 7 days old and have a minimum of 10 comment karma."* | `wg` |
| 2 | **r/WordleSpinoffs** (capture 2026-08-01) | Only two rules exist; r/wordle rule 4 explicitly redirects here: *"This bars spinoffs, ripoffs, and other NYT games for the time being. Visit /r/WordleSpinoffs for content of this kind!"* `[community §1.2, §1.3]` | Link or text post. **Rule 1 is mandatory and applies:** *"if you used AI to help code your new Wordle game (in whole or in part), write your post, or otherwise contribute to any content shared on this sub, you must disclose that, and flair your post as such. **No exceptions.**"* This codebase was built with Claude Code — **the AI flair is not optional** | `ws` |
| 3 | **r/motorcycle** (singular; 294,774 readers @2026-07-16) | Rule 3: *"No Self promotion **with no real point** to being posted to /r/Motorcycle"* — i.e. permitted when it has a point. Sidebar: *"Lightly moderated and anything and everything about Motorcycles."* `[community §2.2]` | Link or text post; lead with the motorcycle content, not the tech | `mc` |
| 4 | **Aggregator directories** | listdle.com: *"must be a **free-to-play daily game which does not require log in**"*; aukspot/dles README: *"fill out this form"* `[community §4.1]` | listdle: `https://listdle.com/submit` (URL, title, category — pick **OTHER**, there is no motorcycle or transport category; description; optional email). aukspot/dles: `https://tally.so/r/mOKOea`, or a `dle suggestion` issue, or a PR to `dles.json` copying an existing entry and **removing the `id` field**. dles.gg: no working `/submit` route — email **peter@dles.gg** | `ld` |
| 5 | **r/CafeRacers** (capture 2025-07-30), **r/vintagemotorcycles**, **r/Sportbikes** | r/CafeRacers rule 1: *"users should have a ratio of **approx 1 to 10 or less of promotional content to community participation**"* `[community §2.5]` | Only if the operator's account clears the 1:10 ratio. Secondary, week 2+ | `cr` / `vm` / `sb` |
| 6 | **Hacker News — Show HN** (guidelines fetched live 2026-09-03) | *"Show HN is for something you've made that other people can play with… The project should be non-trivial… Please make it easy for users to try your thing out, ideally without barriers such as signups"* `[community §3.1]` | `Show HN: Motodle – a daily motorbike guessing game` + a first comment explaining how and why. **Expect a low score:** every large HN thread for a daily game (Worldle 879, Nerdle 344, Tradle 476) was a **plain link submission, not a Show HN**, of a bare title, days-to-weeks after the game was already spreading elsewhere, often submitted by a third party. Recent comparable Show HNs score 1–8 points; the outlier is 35 `[community §3.2]` | `hn` |

**Rejected venues, each closed by its own rule** `[community R4]`:

- **r/motorcycles** (~1.1M weekly visitors — the largest moto sub): rule 5 lists as spam *"**Apps, web apps, websites, and services that you created.**"* Do not post. Do not "test the waters".
- **r/InternetIsBeautiful**: rule 3 *"No Webgames — webgames are not allowed. **This includes quizzes, puzzles, etc.**"*
- **r/puzzles**: rule 5 *"Please do not post puzzles from active contests, **which includes daily puzzles**… **Breaking this rule may result in an immediate ban.**"* Rule 1 confines self-promotion to a weekly stickied thread.
- **r/wordle**: rule 4 bars spinoffs (see r/WordleSpinoffs above).
- **r/webdev**: rule 5 — showing off a project is *"limited to Showoff Saturday"*, and *"Think project, not product."*
- **r/wordgames**: rule 3 scopes the sub to *"word games, puzzles, or linguistics-based gameplay"*. Motodle is not a word game.
- **r/dailygames**: rule 7 requires *"All Daily Series are required to use the comments… to affect the next one"* — it is for comment-driven gamemaster series, not browser games.
- **r/playmygame**: permitted in principle (rule 1 free-to-play, rule 3 direct link, rule 6 one post per month), **but rule 4 says "We do not allow full-AI-generated games here and all games should have low to no Generative AI in their development."** Given how this codebase was built, that is a real conflict. **Default: skip, or mod-mail first.** See operator decision D4.
- **r/SuggestAMotorcycle**: rule 3 *"**Only requests for information should be posted to this subreddit**"* — excludes a game link by construction.

**Name caution.** The "-dle" name, the coloured tile grid and the emoji share grid are exactly the elements the New York Times named in its **March 2024 DMCA campaign against hundreds of Wordle clones** (which targeted "Reactle" *and everyone who had forked it*, ~1,900 forks, and asserted rights in the 5×6 grid and green-for-correct tiles), and NYT was reported in a legal dispute with **Worldle** over the name in May 2024 `[community §9, R9]`. **Practical rule for the playbook: do not put "Wordle" in a post *title*.** A body comparison ("like Wordle, but for motorbikes") is how every venue's audience will describe it anyway and is ordinary comparative reference. F3 makes this slightly sharper: on the flip, source code as well as a site sits in that surface.

## C.2 Draft post 1 — r/WebGames (the strongest venue)

Rule 2 requires the title to begin with the game's name. Link post; the URL **is** the submission.

**Title**
```
Motodle – guess the motorbike from a photo that zooms out. 5 tries, one bike a day.
```

**URL**
```
https://playmotodle.com/?r=wg
```

**First comment (post it yourself, immediately after submitting)**
```
I built this because I could never remember which bike was which, and the car version
(Cardle) is fun but I wanted something with more bikes in it.

How it works: you get a tight crop of a photo of a motorbike. Guess make, model and year.
Each wrong guess zooms the photo out one step — five levels, five tries. Tiles score each
field independently: green is exactly right, yellow is a hint (same country as the make, or
that model was on sale in that year), red is nothing. Only green scores.

Some notes since this sub asks direct questions:
- No account, no sign-up, no cookies, no ads, no third-party scripts, no third-party tracking.
  Your guesses and stats live in your own browser; the only thing the site records is a first-party
  hit when you finish or share a round (puzzle number, won/lost/gave up, which guess, score) — no
  IP address is kept. Full detail on the About page.
- Works on a phone. Colourblind palette in the settings.
- There's an archive — the icon in the header — so you can play past days without waiting.
- Every photo is from Wikimedia Commons under a CC or public-domain licence, credited in the
  app (footer → Photo credits) with a link to the file and the licence deed.
- It's free and it stays free; source is at github.com/reenchree/motodle.

Feedback very welcome, especially on the year hint — that's the rule people find least
obvious. Please don't post today's answer in the thread; spoiler tags are fine for a past day.
```

**Notes for the poster.** Confirm the account clears rule 7 (7 days old, 10+ comment karma) before submitting `[community R5]`. Do not use the word "Wordle" in the title. Do not include a second link before the game link. **Do not restore the shorter privacy bullet** — the one claiming that nothing about your game is kept outside your own browser. With the beacon shipped (D1's default) that is false: the outcome, score, guess index and puzzle number go to CloudFront and are retained 90 days. This is the first venue, the highest-value post, and the claim is checkable by anyone with devtools open. C.3's r/motorcycle draft says only "no cookies, no third-party tracking", which is accurate as written and needs no change.

## C.2b Draft post 2 — r/WordleSpinoffs (the venue with the one mandatory formatting rule)

C.1 records that this sub's rule 1 ends **"No exceptions."** for AI disclosure and flair, and this codebase was built with Claude Code — so under F8 this is the highest-risk post in the plan and the one that must not be improvised on the night. **Set the AI flair before submitting.** The flair is half of the rule, not a nicety; a flairless post is a removal.

**Title** — no "Wordle" in it (see the name caution in §C.1):
```
Motodle – a daily guess-the-motorbike game: one photo, five tries, the photo zooms out
```

**URL**
```
https://playmotodle.com/?r=ws
```

**First comment.** The **first line of the body must read exactly**:
```
Disclosure, per rule 1: this game was built with AI assistance (Claude Code) — code, and some of this post.
```
Follow it with the same body as C.2's first comment, **including C.2's corrected privacy bullet** — the one that discloses the first-party finish/share hit, not the shorter earlier wording.

**Notes for the poster.** Flair first, submit second. Wait 48 hours after r/WebGames (C.4). Do not reuse C.2's title verbatim across both subs.

## C.3 Draft post 3 — r/motorcycle (the motorcycle venue)

Rule 3 permits self-promotion that has "a real point" — so lead with bikes, not with software. Text post with the link in the body reads less like an ad than a bare link post here.

**Title**
```
I made a daily "guess the bike" game — one motorbike photo a day, five tries
```

**Body**
```
https://playmotodle.com/?r=mc

I've been riding for years and still catch myself squinting at a bike at a light going
"...is that an SV650 or a Gladius?" So I built a small daily game about exactly that.

You get a close crop of one bike. Guess the make, the model and the year. Wrong guess zooms
the photo out a step; you get five looks total. The colours tell you something: green means
that field is right, yellow on a make means you guessed a make from the same country, yellow
on a model means that model was on sale in the year you guessed. New bike every day, and
there's an archive if you want to catch up.

The photos all come from Wikimedia Commons under Creative Commons or public-domain licences —
the photographer, the licence and a link to the original file are credited in the app for
every bike.

Free, no account, no ads, no cookies, no third-party tracking, works on a phone. I'd genuinely
like to know whether the bikes are too obscure or too easy — that's the thing I have the least
confidence in, and I'd rather hear it from riders than guess.

Please don't drop today's answer in the comments; grids are fine.
```

**Notes for the poster.** This is the third post, not the second — C.2b sits between it and r/WebGames. Not r/motorcycle**s** — that sub's rule 5 bans this outright. Do not cross-post the identical body to r/CafeRacers the same day.

## C.4 Timing

- **Precondition, non-negotiable:** B11's runway check shows ≥30 days. The moment the runway is exhausted the site silently starts showing "No Motodle today" at each player's local midnight, with no server to notice `[community §6]`.
- **There is no "just after the puzzle drops" window** — see the note at the top of §C. Tune to the audience's clock only.
- **Reddit:** Mon–Thu, **09:00–13:00 ET**; weekends underperform, and a post's fate is largely sealed in the first ~90 minutes `[community §6]`. These are marketing-blog analyses, not Reddit-published data — treat as a soft prior. General social data (Sprout Social, ~2B engagements) puts Tue/Wed highest and Sunday worst `[community §6]`.
- **Sequencing:** r/WebGames first, alone. Wait **48 hours**, then r/WordleSpinoffs. Wait another 48–72 hours, then r/motorcycle. Aggregator submissions any time (they are queues, not feeds). HN last, or not at all. **Never two subs in the same hour** — that is what reads as a spam campaign to both mods and the sitewide filters, and several subs evaluate self-promotion against the *account's recent history*, not the post `[community §2.5, §1.8, R5]`.
- **Be present for 3 hours after posting.** The first 90 minutes decide it.

## C.5 In the comments

- **Spoiler etiquette, and say it in the post.** The strongest norm across these communities is that the *current* day's answer must not appear in a thread **at all** — r/wordle rule 1: *"Posts and comments shouldn't reveal ANYTHING about the current Wordle, in any time zone—EVEN IF YOU USE SPOILER TAGS"*, minimum three-day ban `[community §5]`. Both drafts above carry the one-line ask. r/WebGames supports `>!spoiler!<` and has a spoiler wiki page `[community §1.1]`.
- **If someone posts tomorrow's answer** (F6 — two curls, and they will figure it out): do not argue about it in-thread. **Report it and ask the mods to remove it**, then reply once, neutrally: "please don't post future days — it spoils it for people playing along." Escalating in public advertises the hole. If it happens more than once, that is the trigger to apply B10's held M5.
- **Share grids in comments are good and should be encouraged** — two were pasted straight into the 879-point HN Worldle thread, and the whole Wordle share phenomenon is grids in threads `[community §3.3, §5]`. The grid is spoiler-safe by construction: it carries colours, not values, and a give-up appends no row so it is deliberately indistinguishable from a loss.
- **Answer the questions this audience always asks** — every one is evidenced from the Worldle HN thread `[community §3.3]` and every one has a good answer here:
  - *"Can I play previous days?"* → Yes: the archive icon in the header, on any day, no waiting. (This was the single most-repeated request in that thread.)
  - *"What does yellow mean?"* → Same country as the make, or that model was on sale in that year. It is a hint, not partial credit — only green scores.
  - *"Where do the photos come from?"* → Wikimedia Commons, CC or PD, credited in-app per photo with a link to the file and the licence deed.
  - *"Won't it run out?"* → Point at the archive and the runway, honestly.
  - **Plus one specific to this game:** *"my friend and I have different puzzle numbers"* → the day rolls over at **your** local midnight, not a global one, so two players in different time zones can legitimately see different `#N` at the same instant `[community §6]`.
- **Do not reply to every comment with the link.** Reply with substance; the link is in the post.

## C.6 The metric to watch, and when to call it

Read from A.6. In order of usefulness:

| When | Query | "It worked" |
|---|---|---|
| First 90 min | Q1 filtered to `venue = 'wg'`, by hour | ≥150 page loads attributable to the venue |
| First 24 h | Q1 | ≥500 page loads for the venue; total day ≥3× the pre-launch baseline |
| First 24 h | Q3 | completion ≥40% — a first-time visitor who finishes a round is the only number that means the game is good, as opposed to the title being good |
| Day 2–7 | Q1 with `venue = '(none)'` | **The real signal.** Direct/untagged loads *rising* after the post-day spike means people came back and told someone. A spike that decays to the old baseline within 48 h means the post worked and the game did not. |
| First 24 h | Q5 (beacon) | **share attempts** ≥15% of finished rounds. *Attempts*, not shares: the beacon fires before the share resolves and `handleShare()` is bound on two modals, so one player can contribute several rows for one round and this ratio **can exceed 100%** — which is not a bug (A.6 Q5, D13) |
| Any time | Q2 | sanity check only; expect it to badly undercount Reddit `[analytics, "Reddit's referrer behaviour"]` |

**Call it a success** if, seven days after the first post, daily page loads are at or above **3× the pre-launch baseline** with completion still ≥40% and **more than half of them untagged**. That is retention, not a spike. **Call it a miss** if day-7 loads are back to baseline — in which case the diagnosis is in Q3 and Q4: high loads with low completion means the first screen or the help modal is the problem (see D9), and low loads means the venue or the title was wrong, and the next venue is worth trying with a different title.

**Baseline first.** Enable logging (A.3) and let it run for **at least 24 hours before the first post** — delivery is only reliable ~4 hours after enabling and can lag 24 h `[analytics §b1]`, and without a baseline every number afterwards is uninterpretable.

## C.7 What NOT to do

1. **Do not post to r/motorcycles** — rule 5 names "apps, web apps, websites, and services that you created" as spam. It is the biggest sub and it is closed.
2. **Do not post to r/InternetIsBeautiful, r/puzzles or r/wordle** — each bans this by an explicit rule, and r/puzzles says "may result in an immediate ban".
3. **Do not ask anyone to upvote or comment.** HN: *"Please don't ask friends to upvote or comment. That's not ok on HN."* `[community §3.1]` It is also the fastest route to a sitewide Reddit action.
4. **Do not post to four subs the same day.** Several subs evaluate the *account's* ratio, not the post: r/InternetIsBeautiful's 90/10, r/gaming's "10% max on submissions… just your sitewide activity", r/CafeRacers' 1:10, r/wordgames' "participate meaningfully in other discussions" `[community §2.9]`.
5. **Do not put "Wordle" in a title** (§C.1 name caution).
6. **Do not omit the AI flair on r/WordleSpinoffs** — its rule 1 ends "No exceptions."
7. **Do not use a URL shortener** and do not link to a directory or collection first — r/WebGames rule 3 requires the most direct link possible; r/gaming rule 6 bans shorteners.
8. **Do not post before the runway check passes.** A "No Motodle today" screen in front of a Reddit audience is unrecoverable.
9. **Do not confirm or deny an answer in a thread**, even for a past day, without a spoiler tag.
10. **Do not conflate the two "dles" directories** — dles.gg and dles.aukspot.com are different sites with different submission routes `[community R12]`.

---

# D. Operator decisions

1. **Ship the beacon, or logs only?** **Default: ship it** (A.5). It is the only source of share rate, which F5 names, and it splits completion into won/lost/gave-up. *Alternative (logs only):* you still get visits, referrers, per-venue attribution and a completion proxy from `full.webp` (Q3), and you touch zero application code — but share rate becomes unmeasurable and "gave up" is invisible. **Either way, apply A.7's matching conditional rewrite to the privacy text before shipping it.**
2. **Keep `c-ip` in `record_fields`?** **Default: drop it** (A.3). *Alternative (keep):* you gain a crude IP+UA "unique visitors" approximation that undercounts households/CGNAT and overcounts anyone whose IP changes mid-day — and you take on GDPR personal-data processing (CJEU C-582/14 *Breyer*) requiring a legitimate-interest basis and A.7's conditional rewrite (b) of the privacy text — which must ship in the same push as the `record_fields` change, not after it.
3. **F6: accept the future-puzzle exposure at launch?** **Default: yes — accepted, with no mitigation shipped** (B10). `robots.txt` is *not* a mitigation and no longer pretends to be one: it ships as `Allow: /`, because blocking `/puzzles/` would make Google's indexed snapshot of `/` the "couldn't load" error screen while `sitemap.xml` asks Google to index it (B3). *Alternative (apply M5 now):* the two-curl leak closes to ≤14 hours, at the cost of a new branch in the viewer-request path of every request during launch week, untested by CI, with an unverified question about whether its 404s carry the security headers.
4. **Post to r/playmygame?** **Default: skip.** Its rule 4 — "low to no Generative AI in their development" — plausibly excludes this codebase `[community §1.9]`. *Alternative:* mod-mail first and ask; a removal is cheap, a ban is not.
5. **Post to Hacker News at all?** **Default: yes, but last and with low expectations** — the data says Show HN daily games score 1–8 points and the big threads were third-party link submissions weeks later `[community §3.2]`. *Alternative (skip):* costs nothing; HN is not where this audience is.
6. **Contact affordance: GitHub Issues, or an email address?** **Default: GitHub Issues only** (B4). *Alternative (a `mailto:`):* reachable by non-developers, at the cost of a permanent spam address on a page a Reddit thread points at. Note the Issues link is dead until the flip (B6) — sequence accordingly.
7. **`.claude/` before the flip: untrack, or keep and scope the licence?** **Default: untrack** (B6 step 1). *Alternative (keep):* you must add an explicit scope clause to `LICENSE` excluding `.claude/**` from the MIT grant, restore the vendored skill's Apache-2.0 NOTICE, and accept that anyone cloning the repo and opening it in Claude Code executes `.claude/skills/impeccable/scripts/hook.mjs`. Note that untracking does **not** rewrite history — the blobs stay reachable in the **16** existing commits (`git rev-list --all --count` → 16, verified; the recon report's "15" was off by one). Nor does it remove the operator's email address from every commit's author and committer metadata, which becomes public on the flip (B6 step 2). A full scrub means a history rewrite, which is a separate decision.
8. **Scrub the AWS account id `051946164308` from `docs/PLAN.md` (15 lines)?** **Default: leave it.** Account ids are not credentials, the bucket is private and OAC-only, and the deploy role's trust policy is `StringEquals` on repo+branch. *Alternative (scrub):* touches 15 lines of a 7,176-line document, makes the recorded verification commands unusable, and buys marginal enumeration resistance.
9. **Fix the two known first-impression UX gaps before posting?** Both are recorded in PLAN §5.14 and neither is in F1–F8, but they are exactly what a Reddit audience judges: (a) **K3** — the mandatory first-run help modal hides its own "Got it" below an un-hinted scroll at 360×640, i.e. the *first thing a phone visitor from Reddit sees* may look broken; (b) **`openResult()` has no caller anywhere in `src/`**, so closing the result modal permanently removes the answer photo, attribution and score for that session `[community R13]`. **Default: fix (a) before posting** — it sits directly on the funnel Q3 measures, and a bad first screen makes every launch metric uninterpretable. **Default: fix (b) if cheap, else accept** — it annoys the people who already finished, which is a better problem to have.
10. **Budget cap $10/month?** **Default: yes** (B8). *Alternative ($5):* alerts sooner but will fire on a genuine success spike; *alternative ($25):* fewer false alarms, later warning of a misconfiguration.
11. **Invalidate `/*` instead of the explicit path list?** **Default: yes** (B1 edit 3) — 1 path per deploy instead of 9, and `/puzzles/*` already evicts every image on every deploy today. *Alternative (keep an explicit list):* `/assets/*` stays warm at the edge across deploys, at 9 paths per deploy → ~111 free deploys/month.
12. **Enable the CloudFront "additional metrics" (cache hit ratio)?** **Default: no** — up to ~$2.40/month per distribution as custom metrics, and Q3/Q4 answer the questions that matter `[ops §5]`.

13. **Share beacon: count share *attempts*, or count completed shares?** **Default: count attempts, and name the metric honestly — no code change.** `handleShare()` is bound to `onshare` on **both** `StatsModal` (`src/App.svelte:211`) and `ResultModal` (`:220`), and `beacon('s', …)` fires *before* `shareSink.share()` resolves, so one player can fire several `e=s` rows for one round and Q5's ratio **can legitimately exceed 100%**. The default keeps the call exactly where A.5 puts it and reports the number everywhere as **"share attempts per finished round"**, stating that it can exceed 100% (A.6 Q5, C.6). *Alternative (count completed shares):* move `beacon('s', …)` inside the `.then()` and fire only for `outcome === 'copied' || outcome === 'shared'` — a truer number, at the cost of losing the manual-fallback path (`outcome === 'manual'`, where the player is shown the text to copy by hand, which is a real share on the browsers that need it) and of adding a branch to a code path that currently cannot fail. **Either way the beacon must carry `p`** (A.5): without it Q5's `p=0` predicate drops every share row and the metric reads 0 forever, which is what both critics flagged as a blocker.

---

# E. Deliberately not done

| Not done | Trigger that would revisit it |
|---|---|
| **A web app manifest / PWA install / `apple-touch-icon`** | `manifest-src` is absent from the CSP so a `<link rel="manifest">` falls through to `default-src 'none'` and is blocked `[repo-readiness §1]`. Revisit if players ask for a home-screen install — it needs a CSP change in all four pinned places plus an icon set. |
| **CSP violation reporting (`report-to`)** | Needs a collector: a backend and a third-party origin in `connect-src`, breaking F1 twice `[ops §5]`. Revisit only if a CSP block ever ships to production undetected despite the preview-header + contract-test + e2e chain. |
| **M5, the CloudFront date gate for future puzzles** | Someone posts tomorrow's answer in a public thread, or the same person does it twice. Fully specified and ready in B10 — apply in a change window, never on a launch day. |
| **M2/M3/M4 (manifest trimming, build-time date filter, scheduled daily deploy)** | Only if M5 lands and the *schedule* (as opposed to the answers) still needs hiding. M3/M4 would make the site deploy itself, which is a posture change, not a fix `[ops §7]`. |
| **A `-b` republish prefix for corrected crops** | §9.5 describes it; it has **no implementation** — `srcPrefix` is hard-coded to `` `img/${paddedNumber}/` `` in `tools/generate.ts:80` and `tools/schedule.ts:410` `[ops §6]`. A re-crop today rewrites the same `immutable` key, so anyone who already loaded the bad crop keeps it for a year with no revalidation. Revisit the first time a genuinely wrong image ships on a high-traffic day. |
| **Unique-visitor counting** | Impossible without either `c-ip` (D2) or a `localStorage` analytics flag (which is exactly what ePrivacy Art 5(3) governs). Revisit only if a sponsor or directory demands a "uniques" number; the honest units stay page loads and completions. |
| **Prometheus/blackbox monitoring of the public site from sea-k3s** | Needs `json_exporter` (not deployed), a new numeric manifest field, and it goes silent during a home WAN outage `[ops §4]`. Revisit if the GitHub scheduled workflow proves unreliable (auto-disable, or dropped schedule runs) — the pattern and the exact `PrometheusRule` group are in ops recon §4(ii). |
| **Bluesky / Mastodon / Threads / X** | Produced **no primary facts at all** in recon — treat as unresearched, not empty `[community R11]`. Revisit after the Reddit results are in; a channel with unknown rules is not one to launch into. |
| **ADVrider and other motorcycle forums** | ADVrider is behind Tollbit (307 → **402 Payment Required**) and cannot be read by any agent; its self-promotion rules are unverified `[community §4.4, R11]`. Revisit only if the operator reads the rules in a browser first. |
| **Product Hunt** | 24-hour launch cycle from 12:01 AM PT, Tue/Wed/Thu best; the audience is makers, not players, and the first-party rules page 404s so the "one launch per product" rule is unconfirmed `[community §4.3, R11]`. Revisit if the Reddit route stalls. |
| **Hard mode** | Not built anywhere in `src/` or PLAN `[community §5]`. Revisit if the completion rate (Q3) comes in above ~70%, i.e. the game is too easy for the people who stay. |
| **S3 versioning on the site bucket** | Deliberately absent (`infra/s3.tf` comment): git is the source of truth and every deploy is `--delete`. Revisit only if a rollback ever needs an object git does not have. |
| **Athena workgroup / results bucket in Terraform** | Athena's default results location is enough for a handful of hand-run queries. Revisit if the queries become scheduled or shared. |
| **CloudFront Functions cost mitigation** | `www_to_apex` runs on all five behaviours, making the 2M/month Functions allowance the binding free-tier limit at **~6,600 visits/day**, ahead of requests (~33,000/day) and bytes (~55,000/day at the measured ~220 KB average visit) — these are B8's numbers, and **B8's cost table is the authoritative one**. Revisit if sustained traffic approaches 5,000 visits/day: the fix is to drop the function from `/assets/*` and `/puzzles/img/*`, where a `www.` host is impossible in practice because those are only ever loaded as subresources of an already-redirected page. **The beacon spends this same allowance** — one Function invocation per event, not merely one request (A.5). |
| **Fixing `terraform-core`'s `GitHubOIDCECRPushRole` immutable-subject gap** | Not broken today — `dyndns` and `maitre-d` still issue legacy-form subjects `[ops §9]`, contradicting the memory note. Revisit when a **new** repo under `reenchree` needs that role, or when GitHub migrates existing repos. One-line fix: add `"repo:reenchree@213154582/*:*"` to the trust policy's `values`. |

---

# F. Revision log

Two adversarial critiques were run against the plan above: **Critique 1 — privacy / CSP / correctness** (items BL1–BL4, IM1–IM11) and **Critique 2 — ops / cost** (items BL1–BL3, I1–I8). **Every item is applied.** Nothing was judged wrong and left out. Where both critics corrected the same thing, the correction is applied **once**, consistently, and the row says so. Every repo claim a critic made was re-verified against the working tree before its correction was applied — `infra/iam.tf:51-56`, `README.md:141`, `git rev-list --all --count` = 16, `deploy.yml`'s `timeout-minutes: 15` and its `Sync C` comment, `src/lib/game.ts:120-160`, `src/App.svelte:211/220`, `infra/s3.tf:83`, and the footer's absent inner `<div>` all held.

**Two items were resolved *against* each other rather than both applied:**
- **Deploy job timeout** — Critique 1 IM4 said 25 minutes, Critique 2 BL1(d) said 30. **30 is used**, and BL1(d)'s non-fatal waiter is applied with it, which also moots the two critics' disagreement about the waiter's own arithmetic.
- **`Disallow: /catalog.json`** — Critique 2 I8 called it "worth keeping"; Critique 1 BL4 requires it dropped either way. **Dropped.** A blocker beats an improvement, and BL4's reasoning (a blocked subresource makes the indexed render the error screen) applies to that line as much as to `/puzzles/`.

## Critique 1 — privacy, CSP, correctness

| Item | How it was applied |
|---|---|
| **BL1** — share beacon omits `p`, so Q5's `p=0` filter drops every `e=s` row | Fixed **at the source**, not in the query: A.5 call site 2 is now `beacon('s', { n: game.puzzle.number, p: game.isPractice ? 1 : 0 })`; A.5's URL table Shared row gains `p=0`; `beacon.test.ts` gains assertion **2b** pinning `/^\/assets\/mtd\.gif\?e=s&n=42&p=0&c=[a-z0-9]{8}$/`. The share-**attempts** half of the note required a choice, so it became **operator decision D13**: the default keeps the pre-resolve call and renames the metric to "share attempts per finished round", saying plainly that it can exceed 100% (A.6 Q5 and C.6 both reworded); the alternative — moving the call into `.then()` for `copied`/`shared` only — is written out with its cost. Same defect as Critique 2 BL2; applied once. |
| **BL2** — A.7's privacy statement is factually untrue about the beacon | A.7's paragraph replaced with the critic's replacement text **verbatim**. The follow-up prose is re-aimed at the new clause structure, both conditional rewrites (D1 drops the beacon / D2 keeps `c-ip`) are restated against the new sentences, and a short note records *why* the old wording was false so it is not resurrected by a future editor. |
| **BL3** — the r/WebGames draft states something false once the beacon ships | C.2's privacy bullet replaced **verbatim**. C.2's "Notes for the poster" now explicitly forbids restoring the shorter claim, and records that C.3's r/motorcycle draft is accurate as written and needs no change. |
| **BL4** — robots.txt makes Google's rendered snapshot the error screen | `public/robots.txt` now ships exactly `User-agent: *` / `Allow: /` / blank / `Sitemap: https://playmotodle.com/sitemap.xml`. Cascaded to every dependent place: B3's F6 paragraph rewritten around the rendered-snapshot cost (including the critic's fallback wording if the operator overrides); B3's "no `Disallow` of `/assets/`" note added; B10's decision line reworded **verbatim** to "the exposure stands at launch with **no mitigation shipped** (PLAN §13.8's position, unchanged); M5 is specified and held", with a new rationale item 1, renumbered items 2–4, and a rewritten Files/DoD; D3 restated to match; B11's robots check reworded to expect `Allow: /` and no `Disallow` line. |
| **IM1** — `q` is never 6 | A.5's doc comment rewritten to "win → 1..5; loss → always 5 (`game.ts:134-144`); give-up → `guesses.length + 1`, 1..5 (`game.ts:155-158`)", and the URL table's Lost row is now `q=5`. Verified against `src/lib/game.ts:120-160`. |
| **IM2** — `tools/og.ts` emits a transparent-background PNG | `.flatten({ background: '#15181d' })` inserted before `.png(...)` in B2's snippet (reformatted multi-line with the rationale inline), and `tools/og.test.ts` gains `metadata().hasAlpha === false`. Merged with Critique 2 I8's identical B2 sub-point — one fix, applied once. |
| **IM3** — B7(b) probes the wrong puzzle | B7(b) now computes `today=$(date -u +%F)` and curls `/puzzles/$today.json`. **Plus a defect neither critic caught:** the trailing `echo "::notice:: … latest=$latest"` would reference an unset variable under `set -u` once those lines went, so it now echoes `today=$today`. Both facts are written into B7(b)'s numbered "gets wrong if written naively" list. |
| **IM4** — the waiter can time the deploy job out | Timeout raised to **`timeout-minutes: 30`** (IM4 said 25, Critique 2 BL1(d) said 30 — 30 used), in the same edit as the smoke step, and stated as such in B7(b). |
| **IM5** — the DDL drops AWS's `WITH SERDEPROPERTIES ('paths'=…)` | Clause added to A.6's DDL with the 34 declared columns in declaration order, the four `cs(…)` keys in mixed case, and `c-country` appended. A.6's DDL preamble explains the OpenX `case.insensitive` fallback it prevents, flags `c-country` as v2-only and absent from AWS's example, and keeps Step 0 as the operator's diff against the published list (no network was available to fetch it). The critic's "confirmed non-issue" notes are recorded so they are not re-litigated. |
| **IM6** — Q6's venue regex misses URL-encoded referrers | Q6's `SELECT` replaced with `COALESCE(url_extract_parameter(url_decode("cs(referer)"), 'r'), '(none)') AS venue`, and the note under Q6 explains the CloudFront URI-encoding that defeats the old expression. |
| **IM7** — the 4xx alarm's statistic is not what B7c/B9 assume | `threshold` raised to **25**, `evaluation_periods` left at 3, and the per-minute-`Average` reasoning written into the HCL comment as **accepted, not eliminated** noise. Combined in the same block with Critique 2 I3's floor change. |
| **IM8** — no draft for r/WordleSpinoffs | New **§C.2b** added: an AI-flair note, a title with no "Wordle" in it, `?r=ws`, and a body whose first line is exactly `Disclosure, per rule 1: this game was built with AI assistance (Claude Code) — code, and some of this post.` followed by C.2's body **using the BL3-corrected privacy bullet**. C.3 renumbered to "Draft post 3" and its poster note updated. |
| **IM9** — "nothing here identifies you" over-claims | The over-claim is already gone with BL2's replacement text. The optional half is also taken: `x-edge-location` is **dropped** from `record_fields` in `infra/logs.tf` with a comment saying why, and A.7's verification list now names all three absent fields. |
| **IM10** — B5's README sentence contradicts `LICENSE` | B5's row replaced with the critic's replacement sentence **verbatim**, with `LICENSE:6`'s actual grant quoted as the reason. The optional `LICENSE` scope note is added as a recommended follow-on (GitHub's licence detector would otherwise label the whole tree MIT), and B5's Files line updated to mention it. |
| **IM11** — B6 step 2 does not cover commit metadata | B6 step 2 gains `git log --format='%ae%n%ce' \| sort -u` framed as a **knowing decision**, cross-referenced to D7. B6 step 3 rewritten to re-run the scan over `git rev-list --all` and to record **16** commits, not 15 — verified: `git rev-list --all --count` → 16. D7 updated from 15 to 16 and given the same commit-metadata note. |
| *"Verified and correct — no change needed"* list | No edit made, by design. Recorded here so an implementer does not re-litigate: the beacon needs no CSP change, `?r=` survives `GameStore.init()`, `full.webp` is fetched only when the result modal opens, `data.aws_caller_identity.current` already exists, all five behaviours carry `www_to_apex`, `infra/tfplan` is gitignored, the named e2e specs are the right ones, and `vi.stubGlobal('location', …)` works under this repo's vitest 4 + jsdom 30. |

## Critique 2 — ops, cost

| Item | How it was applied |
|---|---|
| **BL1** — B7(b) fails every deploy: the deploy role has no `cloudfront:GetInvalidation` | All five sub-corrections applied together. **(a)** A new sub-workstream **B7(a′)** carries the `infra/iam.tf` change to `actions = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]`, verified against `infra/iam.tf:51-56`. **(b)** The ordering constraint — operator applies the IAM change *before* the B7(b) commit reaches `main` — is stated in B7(a′), in B7's DoD **and** in B1's ordering note, as the critic asked. **(c)** B7(b)'s heading now names "B1 edit 3" as a prerequisite, with the empty-`--id` failure spelled out. **(d)** `timeout-minutes: 30` and the `\|\| echo "::warning::…"` non-fatal waiter, verbatim. **(e)** `grep -om1` replaces `grep -o … \| head -1`, with the `feedback_pipefail_grep_sigpipe` memory cited. |
| **BL2** — Q5's share count is structurally zero | Same defect as Critique 1 BL1; applied once, at the source. The critic's "no change to `beacon.test.ts` assertion 2" is honoured exactly — the share case is **added** as assertion 2b and the win assertion is untouched. |
| **BL3** — every `terraform validate`/`plan` is written as implementer work but is operator-only | Applied throughout. **A.3** gains a standing OPERATOR ACTION paragraph covering every `terraform` invocation in the document, with the `cloud {}`-block and expired-SSO reasoning. The implementer's gate `terraform fmt -check -diff /home/chris/workspace/motodle/infra` is stated in **A.3, B7 (twice) and B8**, and every HCL block is declared "well-formed but unvalidated" until the operator plans. **B7**'s alarms paragraph, its `terraform -chdir … plan` block and its DoD are all relabelled; **B8**'s "implementer's step 1" and its DoD are restated as operator gates against the **5.100.0** docs, and the critic's provider-binary confirmation is recorded with its own caveat ("present is not valid"). The document's **reading key** is corrected too — B7(b) is no longer "independently executable". |
| **I1** — the vended-log delivery charge is not ambiguous | A.3's hedging paragraph replaced: charges apply, AWS's sentence quoted verbatim, cents/month at 1k–10k and a few dollars at 100k, and the previously-unstated point that `output_format = "json"` roughly **doubles** delivered bytes versus `plain` — named as a real cost lever, with the reason the doubling is accepted. |
| **I2** — add AWS's `AWSLogDeliveryAclCheck` statement | Statement appended to `data "aws_iam_policy_document" "logs_bucket"`; `depends_on = [aws_s3_bucket_public_access_block.logs]` added to `aws_s3_bucket_policy.logs`, mirroring the verified pattern at `infra/s3.tf:83`; A.3's operator-IAM list extended with all six extra `logs:` actions plus `s3:GetBucketPolicy`/`s3:PutBucketPolicy`. **One deliberate deviation from the critic's literal snippet:** it puts two arguments on one line inside `principals {}` and `condition {}`; HCL2 requires a newline after each argument, and `terraform fmt -check` — the implementer's own stated gate — would reject it. The block is expanded to one argument per line. Same tokens, same semantics. |
| **I3** — the "two unrelated runway detectors" claim only holds if the launch worked | Floor lowered to `expression = "IF(reqs >= 20, rate4xx, 0)"` with the ~5-requests-per-cold-visit and `evaluation_periods = 3` arithmetic written into the HCL comment. B9's mitigation paragraph rewritten: the honest arming figure is **roughly 100 visits/day sustained**, the detector count drops to one if the launch flops, and the monthly `gh workflow list` check is therefore **not optional at low traffic**. |
| **I4** — `runway.yml` should be two jobs | `runway.yml` split into `jobs.liveness` and `jobs.runway` (`needs: liveness`), with a comment explaining that GitHub's failure email names the failed job. `--retry 3 --retry-delay 5 --retry-all-errors` added to both curls. Cron changed to `'17 */6 * * *'` with the 24 h → 6 h blind-window rationale. B9's contract list gains a bullet for both, its DoD now expects one `::notice::` per job, and B7(c)'s "no `Requests`-low alarm" paragraph now states plainly that a **total** outage produces no CloudWatch signal at all. |
| **I5** — the beacon path is never exercised before production | B11's gate gains step 3, the `curl -sI "…/assets/mtd.gif?e=w&n=1&c=test"` check with its expected 200 / `image/gif` / `immutable`, plus the reason no test covers it. An operator step follows: play one real round, then run Q5 for that date and confirm a non-zero row, allowing for the ~4 h delivery lag. B7(c) gains the "a 404ing beacon inflates `4xxErrorRate` and can false-fire the runway detector" note. |
| **I6** — name the rollback runbook in B7 | B7(b) gains a "Rollback runbook" block: `gh workflow run deploy.yml --ref main -f ref=<last-good-sha>` as an OPERATOR ACTION, with the point that a red smoke test means the site has *already* changed, and that `--ref main` is mandatory because the OIDC trust policy admits only `refs/heads/main`. |
| **I7** — one cost table computed from measured bytes | B8 now carries the single authoritative cost table (56 KB bounce / 480 KB playthrough / ~220 KB average visit; Functions bind at ~6,600 visits/day, requests at ~33,000, bytes at ~55,000), and says the "~$37/month" figure quoted elsewhere is conservative. (a) A.5's beacon-cost paragraph now names the **Function invocation** per beacon, not just the request. (b) B8 gains the FORECASTED warning — one 30–50k-visit day early in the month mails the operator *during a successful launch* — with the $25-second-budget alternative and a stated default. **Cascade neither critic named:** section **E**'s "CloudFront Functions cost mitigation" row said bytes bind at ~150,000 visits/day, contradicting I7's ~55,000; it is reconciled to B8's numbers and points at B8 as authoritative. |
| **I8** — smaller repo-accurate corrections | All applied. **B1** gains **edit 4** rewriting the `Sync C` comment (verified: `deploy.yml:123` reads "Empty today."). **B4** now states the new footer `<div>` wrapper as a deliberate structural change, with the `App.svelte:193-200` / `:339-346` evidence that it is harmless. **A.5** cites `game.svelte.ts:274`, `:284`, `:65-66` and `game.ts:155-158` so no implementer re-derives them. **A.5**'s attribution limitation gains the `?r=` + `?d=` combined-link warning (`replaceState` at `game.svelte.ts:190-191` strips the whole query string). **B3** states that `robots.txt` must not disallow `/assets/`, and why. **B2**'s `.flatten()` is merged with IM2. **B7** now explains *why* `schema/csp-contract.test.ts` cannot break (it splits on `^variable ` and matches only the CSP block). **B8** records the re-verified `terraform-core` greps. **The one sub-point not applied:** "`Disallow: /catalog.json` is worth keeping" — superseded by BL4, which requires it dropped either way. |
