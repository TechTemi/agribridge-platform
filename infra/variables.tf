# Settings you can change. Everything here has a sensible default except the
# two marked REQUIRED, which Terraform will prompt you for if you leave them out.

variable "project_name" {
  description = "Used to name the server and the firewall rules."
  type        = string
  default     = "agribridge"
}

variable "aws_region" {
  description = "Which AWS region to build in."
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = <<-EOT
    Server size.

    t3.medium (2 CPU, 4 GB) is the realistic minimum. The machine runs
    Kubernetes, the application, a database AND the whole monitoring stack.
    Anything smaller and Prometheus will starve the app of memory.
  EOT
  type        = string
  default     = "t3.medium"
}

variable "disk_size_gb" {
  description = "Disk size. Needs room for container images plus monitoring data."
  type        = number
  default     = 30
}

# --- REQUIRED ---

variable "aws_account_id" {
  description = <<-EOT
    REQUIRED. The 12-digit ID of the AWS account you want to build in.

    This is a safety guard. Terraform refuses to run at all if the credentials
    it finds belong to any other account - so it cannot accidentally build in
    a work account that happens to be configured on the same machine.

    To find your account ID: sign in to the AWS console, click your name in the
    top right, and it is shown under "Account ID". Write it without dashes:

        aws_account_id = "123456789012"
  EOT
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be exactly 12 digits, with no dashes or spaces."
  }
}

variable "my_ip_cidr" {
  description = <<-EOT
    REQUIRED. Your own public IP address, with /32 on the end.

    Controls who can reach SSH, Grafana and Prometheus. Find yours by opening
    https://checkip.amazonaws.com in a browser, then write it as, for example:

        my_ip_cidr = "102.89.34.7/32"

    If your internet connection changes address, Grafana will stop loading and
    you will need to update this and run terraform apply again.
  EOT
  type        = string

  validation {
    condition     = var.my_ip_cidr != "0.0.0.0/0"
    error_message = "Do not use 0.0.0.0/0 - that would put Grafana and SSH on the open internet."
  }
}

variable "key_pair_name" {
  description = <<-EOT
    REQUIRED. The name of an EC2 key pair in this region, so you can SSH in.

    Create one in the AWS console under EC2 > Key pairs > Create key pair,
    choose .pem format, and keep the downloaded file safe. Then put the NAME
    here (not the file path).
  EOT
  type        = string
}

variable "grafana_password" {
  description = <<-EOT
    Password for logging into Grafana as 'admin'.

    Choose something you do not mind saying out loud on camera - this cluster
    exists for a few hours and then gets deleted.
  EOT
  type        = string
  default     = "capstone123"
  sensitive   = true
}
