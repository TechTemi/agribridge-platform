# What Terraform tells you once the server is built.
# Run `terraform output` at any time to see these again.

output "aws_account_in_use" {
  description = <<-EOT
    Which AWS account and identity Terraform is using.

    Check this before you apply. If you forgot to run `source aws.env`,
    Terraform silently uses ~/.aws/credentials instead, and this is the only
    place that tells you.
  EOT
  value       = "account ${data.aws_caller_identity.current.account_id} as ${data.aws_caller_identity.current.arn}"
}

output "server_ip" {
  description = "The server's public address."
  value       = aws_instance.server.public_ip
}

output "app_url" {
  description = "The application. Open this in a browser."
  value       = "http://${aws_instance.server.public_ip}:30080"
}

output "grafana_url" {
  description = "Grafana dashboards. Log in as 'admin'."
  value       = "http://${aws_instance.server.public_ip}:30300"
}

output "prometheus_url" {
  description = "Prometheus, if you want to look at raw metrics or alert rules."
  value       = "http://${aws_instance.server.public_ip}:30090"
}

output "ssh_command" {
  description = "Connect to the server."
  value       = "ssh -i ${var.key_pair_name}.pem ubuntu@${aws_instance.server.public_ip}"
}

output "get_kubeconfig_command" {
  description = <<-EOT
    Fetches the Kubernetes credential and saves it as a file called
    'kubeconfig' in the folder you run it from. You need this to set up the
    GitHub secret so the pipeline can deploy.
  EOT
  value = join(" ", [
    "ssh -i ${var.key_pair_name}.pem ubuntu@${aws_instance.server.public_ip}",
    "\"sudo cat /etc/rancher/k3s/k3s.yaml\"",
    "| sed 's/127.0.0.1/${aws_instance.server.public_ip}/'",
    "> kubeconfig",
  ])
}

output "next_steps" {
  description = "What to do now."
  value       = <<-EOT

    ============================================================
     Server is being built. Wait about 5 minutes for setup.
    ============================================================

     1. GET THE KUBERNETES CREDENTIAL

        ssh -i ${var.key_pair_name}.pem ubuntu@${aws_instance.server.public_ip} \
          "sudo cat /etc/rancher/k3s/k3s.yaml" \
          | sed 's/127.0.0.1/${aws_instance.server.public_ip}/' > kubeconfig

     2. TURN IT INTO ONE LINE FOR GITHUB

        base64 -w0 kubeconfig

     3. ADD 3 SECRETS ON GITHUB
        Settings > Secrets and variables > Actions

           KUBECONFIG_B64      the long line from step 2
           DOCKERHUB_USERNAME  your Docker Hub username
           DOCKERHUB_TOKEN     a Docker Hub access token

     4. PUSH YOUR CODE. The pipeline builds and deploys automatically.

     5. OPEN
           app      http://${aws_instance.server.public_ip}:30080
           grafana  http://${aws_instance.server.public_ip}:30300  (admin)

    ============================================================
  EOT
}
