# AgriBridge High-Value Evidence Index

This index highlights the strongest evidence for review. The complete evidence set contains **91 files**, tracked by `final/evidence-sha256.csv`. The manifest itself is hashed separately in `final/evidence-sha256-manifest-hash.txt`.

| Area | Representative evidence | Proof |
|---|---|---|
| Repository lineage | `final/git-history.txt`, `final/main-final-commit.txt` | Inherited baseline, corrective history and final source lineage |
| Corrective PR | `final/pr-2.json` | PR #2 merged into `main` at `a1ea8f5` |
| CI/CD | `final/corrective-cicd-run.json` | Tests, image build/push and Helm deploy all successful in run `33335744208` |
| Kubernetes final state | `final/agribridge-pods-final.txt`, `final/agribridge-deployments-final.txt` | Final workloads healthy before teardown |
| Helm | `final/helm-history-final.txt` | Install, corrective upgrade, rollback and restore sequence |
| Final version | `final/api-version-final.json` | Runtime source/image tag `a1ea8f5` |
| Final readiness | `final/api-readiness-final.json` | `ready`, non-degraded, database/cache healthy |
| Declarative Web fix | `final/web-api-upstream-final.txt` | Namespace-qualified Kubernetes API service FQDN |
| Declarative cookie fix | `final/api-cookie-secure-final.txt` | `COOKIE_SECURE=false` for inherited HTTP demo |
| Prometheus | `cloud-acceptance/prometheus-agribridge-targets.json`, `cloud-acceptance/prometheus-up-agribridge.json` | Both API replicas discovered and scraped successfully |
| Loki | `cloud-acceptance/loki-agribridge-query.json`, `cloud-acceptance/loki-labels.json`, `cloud-acceptance/loki-namespace-values.json` | AgriBridge log streams ingested and queryable |
| Grafana | screenshot from final Explore validation + **Fix Loki URL** troubleshooting conversation | Loki datasource corrected and AgriBridge logs displayed |
| API self-heal | resilience pod/deployment evidence | Deleted API pod replaced automatically; readiness recovered |
| Web self-heal | resilience pod/deployment evidence | Deleted Web pod replaced automatically; FQDN config retained |
| PostgreSQL persistence | `resilience/statefulsets-after-postgres-restart.txt`, `resilience/pvc-after-postgres-restart.txt` | StatefulSet pod recreated using same PVC; data persisted |
| Rollback regression | `rollback/pods-at-revision-1.txt`, `rollback/web-logs-at-revision-1.txt` | Rollback succeeded technically but user-facing `/api/lots` regressed to 502 |
| Rollback recovery | `rollback/helm-history-after-restore.txt`, `rollback/pods-after-restore.txt` | Corrected revision restored successfully |
| Terraform destroy plan | `teardown/terraform-destroy-plan.txt`, `teardown/terraform-destroy-plan-sha256.txt` | Reviewed plan contained exactly 2 destroys |
| EC2 termination | `teardown/ec2-after-destroy.txt` | Instance terminated |
| Security group removal | `teardown/security-group-after-destroy.txt` | `InvalidGroup.NotFound` confirms deletion |
| Credential cleanup | `teardown/local-credential-cleanup.txt` | Kubeconfig and PEM absent after cleanup |
| Evidence integrity | `final/evidence-sha256.csv` | 91/91 evidence inventory |
| Manifest integrity | `final/evidence-sha256-manifest-hash.txt` | Hash of evidence manifest |

## Evidence narrative

The evidence should be reviewed in this order for a concise technical story:

1. `git-history.txt` and `pr-2.json` - source lineage and correction.
2. `corrective-cicd-run.json` - reproducible CI/CD success.
3. `helm-history-final.txt` - release lifecycle.
4. final version/readiness/runtime-setting files - corrected runtime.
5. Prometheus + Loki/Grafana evidence - observability.
6. resilience evidence - self-healing and persistence.
7. rollback evidence - regression reproduction and restoration.
8. teardown evidence - cost/security closure.
9. SHA-256 manifest - integrity of the complete evidence set.

## Publication warning

Do not publish Terraform state, private keys, kubeconfig contents, tokens, passwords, session-cookie values or any other secret material. The evidence index intentionally references only safe operational outputs.
