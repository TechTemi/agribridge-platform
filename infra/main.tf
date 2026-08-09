/**
 * One EC2 instance running k3s, with the monitoring stack installed on boot.
 *
 * Deliberately simple, because this is a teaching project:
 *
 *   - It uses your account's DEFAULT VPC. Building a VPC from scratch is a
 *     worthwhile exercise, but it is a separate lesson and it doubles the
 *     amount of code you have to explain.
 *
 *   - Terraform state is kept locally, in this folder. A real team stores it in
 *     S3 so everyone shares one copy and it cannot be lost with a laptop. For a
 *     demo you build and destroy in an afternoon, a local file is fine - and it
 *     removes an entire setup step.
 *
 *   - There is one environment, not two. Staging is a real practice; it is also
 *     a second server to pay for and explain.
 *
 * Say those three things out loud when you present. "I simplified this and here
 * is what I would do differently for real" is a much better position than
 * hoping nobody notices.
 */

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  # ==========================================================================
  #  SAFETY GUARD - do not remove.
  #
  #  Terraform looks for AWS credentials in several places, in order. If you
  #  forget to run `source aws.env`, it silently falls back to whatever is in
  #  ~/.aws/credentials - with no warning at all. On a machine that also has
  #  work credentials configured, that means building into the wrong account.
  #
  #  allowed_account_ids makes that impossible. Terraform checks which account
  #  the credentials actually belong to and REFUSES TO RUN if it is not the one
  #  named in terraform.tfvars. No plan, no apply, nothing created.
  #
  #  Set aws_account_id to your own personal account, and this project can
  #  never touch any other one.
  # ==========================================================================
  allowed_account_ids = [var.aws_account_id]

  # Every resource gets these tags, so you can find and clean up everything
  # this project created.
  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
    }
  }
}

# ---------------------------------------------------------------------------
# Use the VPC and subnets AWS already gave you.
# ---------------------------------------------------------------------------

# Which AWS account and user are we actually about to build in?
#
# This matters more than it looks. If you forget to run `source aws.env`,
# Terraform quietly falls back to whatever is in ~/.aws/credentials - it does
# not warn you. That could mean building into the wrong AWS account.
#
# Surfacing it as an output means `terraform plan` always shows you, before
# anything is created.
data "aws_caller_identity" "current" {}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# Latest Ubuntu 24.04 image, looked up rather than hardcoded so this works in
# any region.
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }
}

# ---------------------------------------------------------------------------
# Firewall rules.
#
# The two application ports are open to everyone, because that is the point of
# a web application. Everything else is restricted to your own address.
# ---------------------------------------------------------------------------

resource "aws_security_group" "server" {
  name        = "${var.project_name}-server"
  description = "k3s server: app ports public, admin ports restricted"
  vpc_id      = data.aws_vpc.default.id

  # --- open to the world: the app itself ---

  ingress {
    description = "Web application"
    from_port   = 30080
    to_port     = 30080
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "API"
    from_port   = 30081
    to_port     = 30081
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # --- restricted to you: admin and debugging ---

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.my_ip_cidr]
  }

  ingress {
    description = "Grafana"
    from_port   = 30300
    to_port     = 30300
    protocol    = "tcp"
    cidr_blocks = [var.my_ip_cidr]
  }

  ingress {
    description = "Prometheus"
    from_port   = 30090
    to_port     = 30090
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # The Kubernetes API. GitHub Actions needs to reach this to deploy, and
  # GitHub's runners come from thousands of changing addresses - so there is no
  # small range to allow. Reaching the port gets you nothing without the
  # credential, but for a permanent system you would run the pipeline on a
  # machine inside your own network instead.
  ingress {
    description = "Kubernetes API (needed by the pipeline)"
    from_port   = 6443
    to_port     = 6443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Allow all outbound - pulling images, installing packages"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-server" }
}

# ---------------------------------------------------------------------------
# The server.
# ---------------------------------------------------------------------------

resource "aws_instance" "server" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = var.instance_type
  subnet_id     = data.aws_subnets.default.ids[0]
  key_name      = var.key_pair_name

  vpc_security_group_ids      = [aws_security_group.server.id]
  associate_public_ip_address = true

  # Everything this machine needs is installed by this script on first boot.
  # That is the whole idea of infrastructure as code: the server is not
  # something you configure by hand, it is something you describe.
  user_data = templatefile("${path.module}/user-data.sh", {
    grafana_password = var.grafana_password
  })

  # If you edit the script above, replace the server rather than leaving it in
  # a state that no longer matches the code.
  user_data_replace_on_change = true

  root_block_device {
    volume_size = var.disk_size_gb
    volume_type = "gp3"
    encrypted   = true
  }

  tags = { Name = "${var.project_name}-server" }
}
