terraform {
  required_version = ">= 1.10.0"

  backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.28.0, < 7.0.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.6"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

locals {
  site_bucket_arn = "arn:aws:s3:::${var.bucket_name}"
  lambda_origin_id = "lambda-wishes"
  s3_origin_id     = "private-s3-${aws_s3_bucket.site.id}"
  photo_bucket_name = "${var.bucket_name}-guest-photos"
}

# Website bucket and CloudFront OAC

resource "aws_s3_bucket" "site" {
  bucket        = var.bucket_name
  force_destroy = false

  tags = {
    Project     = "AshkinYesodhaaWedding"
    Environment = "production"
    ManagedBy   = "Terraform"
  }
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.bucket_name}-oac"
  description                       = "Private S3 access for the wedding invitation site"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}


# Private guest photo uploads. This bucket is separate from the website bucket
# so frontend deployments using "aws s3 sync --delete" cannot remove guest photos.
resource "aws_s3_bucket" "guest_photos" {
  bucket        = local.photo_bucket_name
  force_destroy = false

  tags = {
    Project     = "AshkinYesodhaaWedding"
    Environment = "production"
    ManagedBy   = "Terraform"
    Purpose     = "PrivateGuestPhotoUploads"
  }
}

resource "aws_s3_bucket_public_access_block" "guest_photos" {
  bucket                  = aws_s3_bucket.guest_photos.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "guest_photos" {
  bucket = aws_s3_bucket.guest_photos.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "guest_photos" {
  bucket = aws_s3_bucket.guest_photos.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "guest_photos" {
  bucket = aws_s3_bucket.guest_photos.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["POST"]
    allowed_origins = ["https://${aws_cloudfront_distribution.site.domain_name}"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# Wishes API resources

data "aws_iam_policy_document" "wedding_invitation_lambda_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "wedding_invitation_lambda_permissions" {
  statement {
    sid    = "UseWishesTable"
    effect = "Allow"
    actions = [
      "dynamodb:PutItem",
      "dynamodb:GetItem",
      "dynamodb:UpdateItem",
      "dynamodb:Query",
    ]
    resources = [
      aws_dynamodb_table.wedding_invitation_wishes.arn,
      "${aws_dynamodb_table.wedding_invitation_wishes.arn}/index/status-created_at-index",
    ]
  }

  statement {
    sid       = "UploadGuestPhotos"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.guest_photos.arn}/uploads/*"]
  }

  statement {
    sid       = "WriteFunctionLogs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.wedding_invitation.arn}:*"]
  }
}

resource "random_password" "wedding_invitation_rate_limit_salt" {
  length  = 64
  special = false
}

resource "aws_dynamodb_table" "wedding_invitation_wishes" {
  name           = "ashkin-yesodhaa-wedding-wishes"
  billing_mode   = "PROVISIONED"
  hash_key       = "pk"
  range_key      = "sk"
  read_capacity  = 5
  write_capacity = 10

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "gsi1pk"
    type = "S"
  }

  attribute {
    name = "gsi1sk"
    type = "S"
  }

  global_secondary_index {
    name = "status-created_at-index"

    key_schema {
      attribute_name = "gsi1pk"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "gsi1sk"
      key_type       = "RANGE"
    }

    projection_type = "ALL"
    read_capacity   = 10
    write_capacity  = 10
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Project     = "AshkinYesodhaaWedding"
    Environment = "production"
    ManagedBy   = "Terraform"
    Purpose     = "GuestWishes"
  }
}

resource "aws_iam_role" "wedding_invitation_lambda" {
  name               = "ashkin-yesodhaa-wedding-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.wedding_invitation_lambda_assume_role.json
}

resource "aws_iam_role_policy" "wedding_invitation_lambda" {
  name   = "ashkin-yesodhaa-wedding-policy"
  role   = aws_iam_role.wedding_invitation_lambda.id
  policy = data.aws_iam_policy_document.wedding_invitation_lambda_permissions.json
}

resource "aws_cloudwatch_log_group" "wedding_invitation" {
  name              = "/aws/lambda/ashkin-yesodhaa-wedding-lambda"
  retention_in_days = 7
}

data "archive_file" "wedding_invitation_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../../backend/wedding_invitation_lambda"
  output_path = "${path.module}/wedding_invitation_lambda.zip"
}

resource "aws_lambda_function" "wedding_invitation_lambda" {
  function_name = "ashkin-yesodhaa-wedding-lambda"
  description   = "Invoked only through the wedding invitation CloudFront distribution."
  role          = aws_iam_role.wedding_invitation_lambda.arn
  runtime       = "python3.12"
  handler       = "handler.lambda_handler"
  filename      = data.archive_file.wedding_invitation_lambda.output_path
  source_code_hash = data.archive_file.wedding_invitation_lambda.output_base64sha256

  memory_size                    = 128
  timeout                        = 300
  architectures                  = ["x86_64"]

  environment {
    variables = {
      TABLE_NAME      = aws_dynamodb_table.wedding_invitation_wishes.name
      RATE_LIMIT_SALT = random_password.wedding_invitation_rate_limit_salt.result
      PHOTO_BUCKET            = aws_s3_bucket.guest_photos.id
      PHOTO_UPLOAD_CUTOFF_UTC = var.photo_upload_cutoff_utc
    }
  }

  depends_on = [
    aws_iam_role_policy.wedding_invitation_lambda,
    aws_cloudwatch_log_group.wedding_invitation,
  ]

  tags = {
    Project     = "AshkinYesodhaaWedding"
    Environment = "production"
    ManagedBy   = "Terraform"
  }
}

resource "aws_lambda_function_url" "wedding_invitation_lambda_url" {
  function_name      = aws_lambda_function.wedding_invitation_lambda.function_name
  authorization_type = "AWS_IAM"
  invoke_mode        = "BUFFERED"
}

resource "aws_lambda_permission" "wedding_invitation_cloudfront" {
  statement_id           = "AllowCloudFrontInvokeWeddingInvitationUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.wedding_invitation_lambda.function_name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = aws_cloudfront_distribution.site.arn
  function_url_auth_type = "AWS_IAM"
}

resource "aws_lambda_permission" "wedding_invitation_cloudfront_invoke" {
  statement_id             = "AllowCloudFrontInvokeWeddingInvitationFunction"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.wedding_invitation_lambda.function_name
  principal                = "cloudfront.amazonaws.com"
  source_arn               = aws_cloudfront_distribution.site.arn
  invoked_via_function_url = true
}

resource "aws_cloudfront_origin_access_control" "wedding_invitation" {
  name                              = "${var.bucket_name}-wedding-invitation-oac"
  description                       = "Allow only the wedding CloudFront distribution to invoke the wedding Lambda URL"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_origin_request_policy" "wedding_invitation" {
  name    = "${var.bucket_name}-wedding-invitation-origin-policy"
  comment = "Forward only headers required by the wishes API and abuse controls."

  headers_config {
    header_behavior = "whitelist"
    headers {
      items = ["Content-Type", "CloudFront-Viewer-Address"]
    }
  }

  cookies_config {
    cookie_behavior = "none"
  }

  query_strings_config {
    query_string_behavior = "none"
  }
}

resource "aws_cloudfront_cache_policy" "wedding_invitation" {
  name        = "${var.bucket_name}-wishes-get-cache"
  comment     = "Short edge cache for approved wishes GET responses; POST requests are never cached."
  min_ttl     = 0
  default_ttl = 30
  max_ttl     = 60

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true

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

# CloudFront

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  comment             = "Ashkin & Yesodhaa wedding invitation"
  default_root_object = "index.html"
  price_class         = "PriceClass_200"

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = local.s3_origin_id
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  origin {
    domain_name              = trimsuffix(trimprefix(aws_lambda_function_url.wedding_invitation_lambda_url.function_url, "https://"), "/")
    origin_id                = local.lambda_origin_id
    origin_access_control_id = aws_cloudfront_origin_access_control.wedding_invitation.id

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  ordered_cache_behavior {
    path_pattern           = "/api/*"
    target_origin_id       = local.lambda_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["HEAD", "DELETE", "POST", "GET", "OPTIONS", "PUT", "PATCH"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = aws_cloudfront_cache_policy.wedding_invitation.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.wedding_invitation.id
  }

  default_cache_behavior {
    target_origin_id       = local.s3_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
  }

  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  depends_on = [aws_s3_bucket_public_access_block.site]
}

data "aws_iam_policy_document" "site_bucket" {
  statement {
    sid       = "AllowCloudFrontReadOnly"
    actions   = ["s3:GetObject"]
    resources = ["${local.site_bucket_arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.site]
}

# Outputs

output "s3_bucket_name" {
  description = "Set as GitHub Actions variable AWS_S3_BUCKET."
  value       = aws_s3_bucket.site.bucket
}

output "cloudfront_distribution_id" {
  description = "Set as GitHub Actions variable AWS_CLOUDFRONT_DISTRIBUTION_ID."
  value       = aws_cloudfront_distribution.site.id
}

output "cloudfront_domain_name" {
  description = "Public HTTPS URL for the invitation site."
  value       = "https://${aws_cloudfront_distribution.site.domain_name}"
}

output "guest_photo_bucket_name" {
  description = "Private S3 bucket containing guest-uploaded photos."
  value       = aws_s3_bucket.guest_photos.bucket
}

output "wishes_table_name" {
  description = "DynamoDB table containing pending and approved guest wishes."
  value       = aws_dynamodb_table.wedding_invitation_wishes.name
}

output "aws_region" {
  value = var.aws_region
}
