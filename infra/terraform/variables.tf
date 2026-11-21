variable "aws_region" {
  description = "AWS region used for the website infrastructure."
  type        = string
  default     = "ap-south-1"
}

variable "bucket_name" {
  description = "Globally unique name for the private website S3 bucket."
  type        = string
}
