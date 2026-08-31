# AgriBridge Platform - Evidence-Driven As-Is DevOps Implementation

> **Status:** As-is implementation lifecycle complete. The AWS demo environment was intentionally destroyed after evidence capture. This repository is the durable implementation and portfolio artifact.

## Executive summary

AgriBridge is a containerized marketplace platform delivered through an evidence-first DevOps workflow using **GitHub Actions, Docker Hub, Terraform, AWS EC2, k3s, Helm, Prometheus, Grafana, Loki and Promtail**.

The delivery deliberately preserved the inherited baseline, validated the application locally, deployed the inherited architecture, reproduced real runtime defects, converted two proven runtime workarounds into declarative Helm fixes, validated observability/resilience/persistence, exercised Helm rollback and restoration, froze the evidence set, and destroyed the live infrastructure.

This repository should be described as a **validated as-is DevOps implementation**, not as a finished production-grade platform.

## Documentation

This repository includes the final evidence-driven documentation produced from the completed as-is implementation lifecycle:

- [AgriBridge As-Is Technical Implementation Report and Runbook](docs/AgriBridge_As-Is_Technical_Implementation_Report_and_Runbook.docx) — detailed implementation record covering repository provenance, local validation, AWS/Terraform provisioning, k3s/Helm deployment, CI/CD, observability, resilience, troubleshooting, remediation, rollback, restoration and teardown.
- [AgriBridge Evidence Index](docs/AgriBridge_Evidence_Index.md) — index of the highest-value implementation evidence and the final integrity/closure records.

The live AWS demonstration environment was intentionally destroyed after acceptance and evidence capture. The repository and documentation are the durable implementation artifacts.

## Final source lineage

| Record | Value |
|---|---|
| Inherited baseline | `4c1aa561c0e168aa97721c03f78a8a80b8484365` |
| Controlled cloud baseline | `60e9d170a33e04fcd86a713c635727b9c5b957df` |
| Corrective PR | `#2 - fix: make Helm runtime compatibility reproducible` |
| Final corrected main | `a1ea8f513170e3dbbe7f9587e36cf3ae69703303` (`a1ea8f5`) |
| Corrective CI/CD run | `33335744208` - success |
| Final evidence integrity | 91 files / 91 SHA-256 entries / PASS |

## Architecture

```text
Developer / Windows PowerShell
        |
        v
GitHub -> GitHub Actions (test -> build/push -> Helm deploy)
        |
        +------> Docker Hub
        |
        v
Terraform-managed AWS EC2
        |
        v
k3s single-node cluster
  agribridge namespace
    API x2 -> PostgreSQL StatefulSet + PVC
           -> Redis
    Web x2 -> API service

  monitoring namespace
    Prometheus + ServiceMonitor
    Grafana
    Loki + Promtail
    Alertmanager / kube-state-metrics / node-exporter
```

## What was validated

| Capability | Result |
|---|---|
| API tests | 40/40 passing |
| Web production build | PASS |
| Local buyer/farmer workflows | PASS |
| Docker image publication | PASS |
| Terraform AWS provisioning | PASS |
| k3s / Helm deployment | PASS |
| GitHub Actions CI/CD | PASS |
| Buyer cloud workflow | PASS |
| Farmer cloud workflow | PASS |
| API self-healing | PASS |
| Web self-healing | PASS |
| PostgreSQL persistence | PASS |
| Prometheus scraping | PASS - both API replicas `up=1` |
| Loki/Promtail ingestion | PASS - 7 AgriBridge streams returned |
| Grafana log query | PASS |
| Controlled Helm rollback | PASS |
| Corrective release restoration | PASS |
| Terraform/AWS teardown | PASS |
| Credential/secret cleanup | PASS |

## Runtime defects found during delivery

### 1. Concurrent demo seed race

Two API replicas can attempt to seed demo users concurrently on first startup. One replica reproduced a unique-key violation on `users_email_key`. The pod later restarted and continued because demo data was already present.

**Disposition:** documented as inherited application-level concurrency/idempotency debt. Not silently redesigned during the as-is delivery.

### 2. Web-to-API Kubernetes DNS failure

The inherited chart set:

```text
API_UPSTREAM=agribridge-api:3000
```

The Web container uses a variable-based nginx `proxy_pass` and explicit resolver. In the live k3s environment the short name produced NXDOMAIN and `/api/*` returned `502`.

The proven runtime value was:

```text
agribridge-api.agribridge.svc.cluster.local:3000
```

PR #2 made this declarative in `charts/agribridge/templates/web.yaml`.

### 3. Secure session cookie over HTTP

The inherited demo runs `NODE_ENV=production` on plain HTTP NodePort access. With `COOKIE_SECURE` unset, the session cookie received the `Secure` attribute and `/api/auth/me` returned `401`.

The demo-compatible runtime setting:

```text
COOKIE_SECURE=false
```

made authentication work over the inherited HTTP demo. PR #2 made this chart-configurable. **A real TLS production deployment should override it to `true`.**

## Observability evidence

Prometheus validation included:

- `/-/ready` = HTTP 200
- both API replicas discovered by the ServiceMonitor
- both targets `health=up`
- `up{namespace="agribridge"}` = `1` for both replicas
- `/metrics` = HTTP 200

Loki/Promtail/Grafana validation included:

- Loki readiness = `ready`
- Loki namespace values include `agribridge`
- direct LogQL query returned `status=success`, `resultType=streams`, **7 streams**
- Web, API and PostgreSQL streams observed
- Grafana Explore displayed real AgriBridge logs for `{namespace="agribridge"}`
- the earlier **Fix Loki URL** troubleshooting sequence is retained as historical evidence of datasource diagnosis

## Resilience and rollback

The implementation proved:

- deleting an API pod caused Kubernetes to create a healthy replacement
- deleting a Web pod caused Kubernetes to create a healthy replacement while retaining the corrected upstream configuration
- deleting the PostgreSQL StatefulSet pod recreated it using the same PVC; business data remained present
- Helm rollback from corrected revision 2 to inherited revision 1 succeeded technically, but `/api/lots` regressed to `502`
- restoring revision 2 created revision 4 and returned the corrected images/configuration with `/api/lots=200` and `/api/auth/me=200`

This rollback test exposed a useful production lesson: **infrastructure-level health can be green while an application dependency path is broken**.

## Evidence integrity

Evidence was captured throughout the lifecycle under the project evidence directory. The final cryptographic inventory contains:

```text
Evidence files:   91
Manifest entries: 91
PASS: final evidence manifest is complete.
```

The manifest itself is independently SHA-256 hashed.

High-value artifacts include:

- `final/pr-2.json`
- `final/corrective-cicd-run.json`
- `final/helm-history-final.txt`
- `final/api-version-final.json`
- `final/api-readiness-final.json`
- `cloud-acceptance/prometheus-agribridge-targets.json`
- `cloud-acceptance/loki-agribridge-query.json`
- `rollback/web-logs-at-revision-1.txt`
- `teardown/terraform-destroy-plan.txt`
- `teardown/ec2-after-destroy.txt`
- `teardown/local-credential-cleanup.txt`
- `final/evidence-sha256.csv`
- `final/evidence-sha256-manifest-hash.txt`

## Final teardown state

The live demo is intentionally offline. Final closure verified:

```text
Terraform resources remaining: 0
Kubeconfig exists: False
PEM exists: False
terraform.tfvars exists: False
Build and deploy: disabled_manually
GitHub Actions secrets: none
Git working tree: clean main
```

## Production-readiness gaps

This as-is implementation is **not** production architecture. Priority hardening includes:

- TLS ingress/load balancer and DNS
- private/restricted Kubernetes API and monitoring endpoints
- remote encrypted Terraform state with locking
- OIDC/short-lived deployment identity instead of a long-lived kubeconfig secret
- idempotent/transactional migration and seed strategy
- managed/HA PostgreSQL and Redis with backup/restore
- SCA/security gates, SBOM, image signing and provenance
- multi-node/managed Kubernetes and autoscaling
- network policies and tighter RBAC
- synthetic/integration health checks, SLOs and actionable alerts
- retention/security controls for logs and metrics
- GitHub Actions dependency/runtime maintenance

## Re-running the demo

The original AWS resources and credentials were destroyed. Re-running the project creates new billable infrastructure and requires fresh credentials.

Typical lifecycle:

```text
clone -> local validation -> Terraform provision -> k3s bootstrap
-> configure repository secrets -> GitHub Actions deploy -> acceptance
-> observability/resilience testing -> evidence capture -> Terraform destroy
```

Do not commit or publish kubeconfig files, PEM keys, Terraform state, tokens, passwords or session cookies.

## Portfolio positioning

The strongest story in this repository is not simply "I deployed an app." It demonstrates a full engineering lifecycle:

**preserve -> validate -> provision -> deploy -> troubleshoot -> observe -> remediate -> self-heal -> persist -> rollback -> restore -> prove -> destroy**.
