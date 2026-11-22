variable "aws_region" {
  description = "AWS region used for the website infrastructure."
  type        = string
  default     = "ap-south-1"

  validation {
    condition     = can(regex("^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$", var.aws_region))
    error_message = "aws_region must be a valid AWS region name."
  }
}

variable "bucket_name" {
  description = "Globally unique name for the private website S3 bucket."
  type        = string

  validation {
    condition = (
      length(var.bucket_name) >= 3 &&
      length(var.bucket_name) <= 63 &&
      can(regex("^[a-z0-9][a-z0-9.-]*[a-z0-9]$", var.bucket_name)) &&
      !can(regex("(\\.\\.)|(^|\\.)-|-($|\\.)", var.bucket_name))
    )
    error_message = "bucket_name must be a valid, globally unique lowercase S3 bucket name."
  }
}
