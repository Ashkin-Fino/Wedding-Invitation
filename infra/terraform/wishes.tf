data "aws_iam_policy_document" "wishes_lambda_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "wishes_lambda_permissions" {
  statement {
    sid    = "UseWishesTable"
    effect = "Allow"
    actions = ["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"]
    resources = [
      aws_dynamodb_table.wishes.arn,
      "${aws_dynamodb_table.wishes.arn}/index/status-created_at-index"
    ]
  }
  statement {
    sid       = "WriteFunctionLogs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.wishes.arn}:*"]
  }
}

resource "random_password" "wishes_rate_limit_salt" {
  length  = 64
  special = false
}

resource "aws_dynamodb_table" "wishes" {
  name         = "ashkin-yesodhaa-wishes"
  billing_mode = "PROVISIONED"
  hash_key     = "pk"
  range_key    = "sk"
  read_capacity  = 5
  write_capacity = 5

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
    name            = "status-created_at-index"
    hash_key        = "gsi1pk"
    range_key       = "gsi1sk"
    projection_type = "ALL"
    read_capacity   = 5
    write_capacity  = 5
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

resource "aws_iam_role" "wishes_lambda" {
  name               = "ashkin-yesodhaa-wishes-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.wishes_lambda_assume_role.json
}

resource "aws_iam_role_policy" "wishes_lambda" {
  name   = "ashkin-yesodhaa-wishes-access"
  role   = aws_iam_role.wishes_lambda.id
  policy = data.aws_iam_policy_document.wishes_lambda_permissions.json
}

resource "aws_cloudwatch_log_group" "wishes" {
  name              = "/aws/lambda/ashkin-yesodhaa-wishes-api"
  retention_in_days = 7
}

data "archive_file" "wishes_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../../backend/wishes"
  output_path = "${path.module}/wishes-lambda.zip"
}

resource "aws_lambda_function" "wishes" {
  function_name = "ashkin-yesodhaa-wishes-api"
  description   = "Guest-wishes API, invoked only through the wedding CloudFront distribution."
  role          = aws_iam_role.wishes_lambda.arn
  runtime       = "python3.12"
  handler       = "handler.lambda_handler"
  filename         = data.archive_file.wishes_lambda.output_path
  source_code_hash = data.archive_file.wishes_lambda.output_base64sha256

  memory_size                    = 128
  timeout                        = 3
  reserved_concurrent_executions = 2
  architectures                  = ["x86_64"]

  environment {
    variables = {
      TABLE_NAME       = aws_dynamodb_table.wishes.name
      RATE_LIMIT_SALT = random_password.wishes_rate_limit_salt.result
    }
  }

  depends_on = [
    aws_iam_role_policy.wishes_lambda,
    aws_cloudwatch_log_group.wishes
  ]

  tags = {
    Project     = "AshkinYesodhaaWedding"
    Environment = "production"
    ManagedBy   = "Terraform"
  }
}

resource "aws_lambda_function_url" "wishes" {
  function_name      = aws_lambda_function.wishes.function_name
  authorization_type = "AWS_IAM"
  invoke_mode        = "BUFFERED"
}

resource "aws_lambda_permission" "wishes_cloudfront_url" {
  statement_id           = "AllowCloudFrontInvokeWishesUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.wishes.function_name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = local.distribution_arn
  function_url_auth_type = "AWS_IAM"
}

resource "aws_lambda_permission" "wishes_cloudfront_invoke" {
  statement_id             = "AllowCloudFrontInvokeWishesFunction"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.wishes.function_name
  principal                = "cloudfront.amazonaws.com"
  source_arn               = local.distribution_arn
  invoked_via_function_url = true
}

resource "aws_cloudfront_origin_access_control" "wishes" {
  name                              = "${var.bucket_name}-wishes-oac"
  description                       = "Allow only the wedding CloudFront distribution to invoke the wishes Lambda URL"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_origin_request_policy" "wishes" {
  name    = "${var.bucket_name}-wishes-origin-policy"
  comment = "Forward only headers required by the wishes API and abuse controls."

  headers_config {
    header_behavior = "whitelist"
    headers {
      items = ["Content-Type", "X-Amz-Content-Sha256", "CloudFront-Viewer-Address"]
    }
  }

  cookies_config {
    cookie_behavior = "none"
  }

  query_strings_config {
    query_string_behavior = "none"
  }
}
