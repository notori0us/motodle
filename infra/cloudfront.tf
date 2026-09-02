resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.name_prefix}-site-oac"
  description                       = "OAC for the ${var.name_prefix} site bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "www_to_apex" {
  name    = "${var.name_prefix}-www-to-apex"
  runtime = "cloudfront-js-2.0"
  comment = "301 www.${var.domain_name} -> ${var.domain_name}, query string preserved"
  publish = true

  code = <<-JS
    function handler(event) {
      var request = event.request;
      var hostHeader = request.headers.host;
      // .toLowerCase(): Host is case-insensitive (RFC 9110); without it "WWW.playmotodle.com"
      // falls through unredirected instead of matching www_domain below.
      var host = hostHeader ? hostHeader.value.toLowerCase() : '';
      if (host !== '${local.www_domain}') {
        return request;
      }
      var params = [];
      var qs = request.querystring;
      for (var key in qs) {
        var entry = qs[key];
        if (entry.multiValue) {
          for (var i = 0; i < entry.multiValue.length; i++) {
            params.push(key + '=' + entry.multiValue[i].value);
          }
        } else if (entry.value === '') {
          params.push(key);
        } else {
          params.push(key + '=' + entry.value);
        }
      }
      var suffix = params.length > 0 ? '?' + params.join('&') : '';
      return {
        statusCode: 301,
        statusDescription: 'Moved Permanently',
        headers: {
          location: { value: 'https://${var.domain_name}' + request.uri + suffix }
        }
      };
    }
  JS
}

resource "aws_cloudfront_response_headers_policy" "site" {
  name    = "${var.name_prefix}-security-headers"
  comment = "CSP verified against the built app; HSTS, nosniff, DENY, strict-origin-when-cross-origin"

  security_headers_config {
    content_security_policy {
      content_security_policy = var.content_security_policy
      override                = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                    = false
      override                   = true
    }
  }
}

# Origin Cache-Control drives every class; these policies only bound it.
resource "aws_cloudfront_cache_policy" "immutable" {
  name        = "${var.name_prefix}-immutable"
  comment     = "Content-hashed assets and per-puzzle image prefixes"
  min_ttl     = 0
  default_ttl = 31536000
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

resource "aws_cloudfront_cache_policy" "short" {
  name        = "${var.name_prefix}-short"
  comment     = "Puzzle JSON, manifest and catalog: 5 minutes"
  min_ttl     = 0
  default_ttl = 300
  max_ttl     = 300

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

resource "aws_cloudfront_cache_policy" "html" {
  name        = "${var.name_prefix}-html"
  comment     = "index.html and 404.html: no browser cache, small edge cache"
  min_ttl     = 0
  default_ttl = 0
  max_ttl     = 300

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = var.name_prefix
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  http_version        = "http2and3"
  aliases             = [var.domain_name, local.www_domain]

  origin {
    origin_id                = local.origin_id
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id           = local.origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.html.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.www_to_apex.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/assets/*"
    target_origin_id           = local.origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.immutable.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.www_to_apex.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/puzzles/img/*"
    target_origin_id           = local.origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.immutable.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.www_to_apex.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/puzzles/*.json"
    target_origin_id           = local.origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.short.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.www_to_apex.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/catalog.json"
    target_origin_id           = local.origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.short.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.www_to_apex.arn
    }
  }

  # Real 404 status, HTML body. NEVER rewrite to index.html (PLAN 9.5).
  custom_error_response {
    error_code            = 404
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 60
  }

  # Safety net: if the ListBucket grant is ever lost, S3 returns 403 for a
  # missing key. Map it to 404 so "no puzzle today" still works.
  custom_error_response {
    error_code            = 403
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 60
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.site.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}
