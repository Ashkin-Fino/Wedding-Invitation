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


variable "photo_upload_cutoff_utc" {
  description = "Optional ISO-8601 UTC cutoff for guest photo upload authorization, for example 2027-03-01T00:00:00Z. Leave empty to keep uploads enabled until manually disabled."
  type        = string
  default     = ""

  validation {
    condition     = var.photo_upload_cutoff_utc == "" || can(timeadd(var.photo_upload_cutoff_utc, "0s"))
    error_message = "photo_upload_cutoff_utc must be empty or a valid RFC3339 UTC timestamp."
  }
}
