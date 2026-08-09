#!/bin/bash
#
# Runs once, automatically, the first time the server boots.
#
# This is the file that turns a blank Ubuntu machine into the platform:
#   1. Docker
#   2. k3s   - a small, single-file Kubernetes
#   3. Helm  - the tool that installs applications into Kubernetes
#   4. Prometheus, Grafana and Loki - the monitoring stack
#
# You never log in and configure anything. If the server is destroyed, running
# terraform apply again produces an identical one, because everything it needs
# is written down here.

set -eux

# Everything this script prints goes to a log you can read later with:
#   ssh ubuntu@<ip> "sudo cat /var/log/user-data.log"
exec > >(tee -a /var/log/user-data.log) 2>&1

echo "=== setup starting: $(date) ==="

# ---------------------------------------------------------------------------
# 1. Basic packages and Docker
# ---------------------------------------------------------------------------

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates docker.io

# Let the 'ubuntu' user run docker without sudo.
usermod -aG docker ubuntu
systemctl enable --now docker

# ---------------------------------------------------------------------------
# 2. Find out our own public address
#
# We need it for the Kubernetes certificate, otherwise connecting from your
# laptop fails with a confusing certificate error.
# ---------------------------------------------------------------------------

TOKEN=$(curl -sS -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 600")
PUBLIC_IP=$(curl -sS -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/public-ipv4)

echo "This server is $PUBLIC_IP"

# ---------------------------------------------------------------------------
# 3. Install k3s
#
# Two things are switched off on purpose:
#   --disable=traefik    We reach services on fixed ports instead of using an
#                        ingress controller. One less moving part.
#   --disable=servicelb  Same reason - we are not using LoadBalancer services.
# ---------------------------------------------------------------------------

# Note: $PUBLIC_IP has no curly braces on purpose.
#
# Terraform reads this file as a template, and it treats a dollar sign followed
# by curly braces as "substitute a Terraform value here". Shell variables in
# this file therefore avoid that form. The one place curly braces DO appear is
# the Grafana password further down, which really is a Terraform value.
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server \
  --tls-san=$PUBLIC_IP \
  --write-kubeconfig-mode=644 \
  --disable=traefik \
  --disable=servicelb" sh -

# Wait until Kubernetes is actually answering before doing anything else.
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
until kubectl get nodes 2>/dev/null | grep -q " Ready"; do
  echo "waiting for kubernetes..."
  sleep 5
done
echo "kubernetes is up"

# ---------------------------------------------------------------------------
# 4. Install Helm
# ---------------------------------------------------------------------------

curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# ---------------------------------------------------------------------------
# 5. Install the monitoring stack
#
# Anything placed in this folder is installed by k3s automatically. So instead
# of running Helm commands ourselves, we describe what we want and k3s does it.
# By the time you can log in, monitoring is already running.
# ---------------------------------------------------------------------------

MANIFESTS=/var/lib/rancher/k3s/server/manifests

# --- Prometheus, Grafana and Alertmanager, in one chart ---
cat > $MANIFESTS/monitoring.yaml <<EOF
apiVersion: helm.cattle.io/v1
kind: HelmChart
metadata:
  name: monitoring
  namespace: kube-system
spec:
  repo: https://prometheus-community.github.io/helm-charts
  chart: kube-prometheus-stack
  version: "65.5.1"
  targetNamespace: monitoring
  createNamespace: true
  valuesContent: |-
    grafana:
      adminPassword: "${grafana_password}"
      service:
        type: NodePort
        nodePort: 30300
      # Tell Grafana where to find Loki, so logs and metrics live side by side.
      additionalDataSources:
        - name: Loki
          type: loki
          url: http://loki.monitoring.svc.cluster.local:3100
          access: proxy
      resources:
        requests: { cpu: 50m, memory: 128Mi }
    prometheus:
      service:
        type: NodePort
        nodePort: 30090
      prometheusSpec:
        # Look for monitoring rules in every namespace, not just this one.
        # Without this, the application's metrics are silently never collected.
        serviceMonitorSelectorNilUsesHelmValues: false
        retention: 6h
        resources:
          requests: { cpu: 150m, memory: 512Mi }
          limits:   { memory: 1Gi }
    alertmanager:
      enabled: true
      alertmanagerSpec:
        resources:
          requests: { cpu: 25m, memory: 64Mi }
    # Turned off: this is a single machine, so these produce noise about
    # components that do not exist separately here.
    kubeControllerManager: { enabled: false }
    kubeScheduler:         { enabled: false }
    kubeProxy:             { enabled: false }
    kubeEtcd:              { enabled: false }
EOF

# --- Loki, for logs ---
cat > $MANIFESTS/loki.yaml <<'EOF'
apiVersion: helm.cattle.io/v1
kind: HelmChart
metadata:
  name: loki
  namespace: kube-system
spec:
  repo: https://grafana.github.io/helm-charts
  chart: loki
  version: "6.21.0"
  targetNamespace: monitoring
  createNamespace: true
  valuesContent: |-
    # Single-binary mode: everything in one pod. Loki can be split into a dozen
    # separate services for scale, which is overkill for one server.
    deploymentMode: SingleBinary
    loki:
      auth_enabled: false
      commonConfig:
        replication_factor: 1
      schemaConfig:
        configs:
          - from: "2024-01-01"
            store: tsdb
            object_store: filesystem
            schema: v13
            index:
              prefix: index_
              period: 24h
      storage:
        type: filesystem
      limits_config:
        retention_period: 24h
    singleBinary:
      replicas: 1
      persistence:
        enabled: true
        size: 5Gi
    # The scalable-mode components must be explicitly zeroed or the chart
    # tries to install them alongside the single binary.
    read:    { replicas: 0 }
    write:   { replicas: 0 }
    backend: { replicas: 0 }
    chunksCache:
      enabled: false
    resultsCache:
      enabled: false
    lokiCanary:
      enabled: false
    test:
      enabled: false
    gateway:
      enabled: false
EOF

# --- Promtail: reads the log files on this machine and sends them to Loki ---
cat > $MANIFESTS/promtail.yaml <<'EOF'
apiVersion: helm.cattle.io/v1
kind: HelmChart
metadata:
  name: promtail
  namespace: kube-system
spec:
  repo: https://grafana.github.io/helm-charts
  chart: promtail
  version: "6.16.6"
  targetNamespace: monitoring
  createNamespace: true
  valuesContent: |-
    config:
      clients:
        - url: http://loki.monitoring.svc.cluster.local:3100/loki/api/v1/push
    resources:
      requests: { cpu: 25m, memory: 64Mi }
EOF

# ---------------------------------------------------------------------------
# 6. Create the namespace the application will be deployed into
# ---------------------------------------------------------------------------

kubectl create namespace agribridge --dry-run=client -o yaml | kubectl apply -f -

# ---------------------------------------------------------------------------
# 7. Make life easier for anyone who does SSH in
# ---------------------------------------------------------------------------

echo 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml' >> /home/ubuntu/.bashrc
echo 'alias k=kubectl' >> /home/ubuntu/.bashrc

# A file the outside world can check to know setup is finished.
touch /var/lib/setup-complete

echo "=== setup finished: $(date) ==="
echo "Monitoring may take another 3-5 minutes to finish downloading."
