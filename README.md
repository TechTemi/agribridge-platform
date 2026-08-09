# AgriBridge — DevOps Capstone

A small marketplace application, deployed the way a real team would deploy one.

The point of this project is not the application. It is the path the application
takes to get from your laptop to a running server: built into containers, tested
automatically, published to a registry, deployed to Kubernetes, and monitored.

---

## What it is

AgriBridge connects farmers who have grain to sell with buyers who want to buy
it. Farmers list produce, buyers place orders, and orders move through stages —
pending, matched, in transit, delivered, settled.

| Part | Built with |
|---|---|
| Web front end | React, served by nginx |
| API | Node.js |
| Database | PostgreSQL |
| Cache | Redis |

---

## The tools, and what each one is for

| Tool | Its job here |
|---|---|
| **Docker** | Packages the app so it runs the same everywhere |
| **Docker Hub** | Stores those packages so the server can download them |
| **Terraform** | Creates the AWS server, described in files instead of clicked in a console |
| **k3s** | A small Kubernetes. Runs the containers, restarts them when they fail |
| **Helm** | Describes everything the app needs in Kubernetes, in one template |
| **GitHub Actions** | Runs tests, builds images and deploys — automatically, on every push |
| **Prometheus** | Collects numbers: requests, errors, memory, orders |
| **Grafana** | Draws those numbers as dashboards |
| **Loki** | Collects log lines so you can search them |

---

## Project layout

```
.
├── app/
│   ├── api/                 the API - Node.js, with tests
│   └── web/                 the front end - React
├── infra/
│   ├── main.tf              the AWS server and firewall rules
│   ├── variables.tf         settings you can change
│   ├── outputs.tf           what Terraform tells you afterwards
│   └── user-data.sh         installs k3s, Helm, Docker and monitoring on boot
├── charts/agribridge/       how the app runs inside Kubernetes
├── .github/workflows/
│   └── deploy.yml           test, build, push, deploy
└── compose.yaml             run the whole thing on your laptop
```

---

## Run it on your laptop first

You need Docker Desktop running.

```bash
docker compose up --build

Then open **http://localhost:8080**.

Three demo logins are on the sign-in page, one click each. The password is shown
on screen.

To stop it:

```bash
docker compose down -v
```

---

## Deploy it to AWS

### What you need first

- An AWS account
- A GitHub account
- A Docker Hub account
- Terraform installed
- An **EC2 key pair** — create one in the AWS console under
  *EC2 → Key pairs → Create key pair*, choose `.pem`, and keep the file safe

### 1. Set your AWS keys

Terraform needs permission to build things. Put your keys in a file that Git
ignores, then load it into your terminal:

```bash
cp aws.env.example aws.env
# edit aws.env and put your real keys in
source aws.env
```

> `source` only affects the terminal you run it in. Open a new terminal and you
> need to run it again, or Terraform will say it has no credentials.

### 2. Tell Terraform which account, which IP, and which key

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
notepad terraform.tfvars
```

Fill in three values. The file explains where to find each one.

⚠ **`aws_account_id` is a safety guard, not just a setting.** Terraform checks
which account your credentials actually belong to and **refuses to run** if it
is not the one you named here.

That matters because of how AWS credentials work: if you forget to
`source aws.env`, Terraform silently falls back to `~/.aws/credentials` with no
warning at all. On a machine that also has work credentials configured, that
would mean building in the wrong account. With this guard set, it simply cannot
happen — you get:

```
Error: AWS account ID not allowed: 123456789012
```

and nothing is created.

### 3. Build the server

```bash
terraform init
terraform apply
```

No arguments needed — Terraform reads `terraform.tfvars` automatically.

Takes about 3 minutes. Then wait another **5 minutes** for the server to finish
installing everything.

Terraform prints what to do next. You can see it again any time:

```bash
terraform output next_steps
```

### 4. Get the Kubernetes credential

This is what lets the pipeline deploy to your server.

```bash
terraform output -raw get_kubeconfig_command
```

Run the command it prints. It saves a file called `kubeconfig`.

Check it works:

```bash
KUBECONFIG=./kubeconfig kubectl get nodes
```

### 5. Add three secrets to GitHub

Turn the credential into one long line:

```bash
base64 -w0 kubeconfig
```

Then on GitHub: **Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
|---|---|
| `KUBECONFIG_B64` | The long line from above |
| `DOCKERHUB_USERNAME` | Your Docker Hub username |
| `DOCKERHUB_TOKEN` | A Docker Hub access token (*Account settings → Personal access tokens*) |

That is all three. There is nothing else to configure.

### 6. Push

```bash
git add -A
git commit -m "Deploy AgriBridge"
git push
```

Watch it on the **Actions** tab. It runs the tests, builds both images, pushes
them to Docker Hub, and deploys — about 5 minutes.

### 7. Open it

```bash
cd infra
terraform output app_url
terraform output grafana_url
```

Grafana logs in as `admin`, with the password from `grafana_password`
(`capstone123` unless you changed it).

---

## When you are finished

```bash
cd infra
terraform destroy
```

Everything is deleted. Because the whole system is described by the files in
this repository, running `terraform apply` again rebuilds it.

Afterwards, tidy up the credentials you created:

- Delete the AWS access key in IAM
- Revoke the Docker Hub token
- `rm aws.env kubeconfig`

---

## Things worth understanding

**Why two health checks?**
`/healthz` asks *is the program running?* and `/readyz` asks *can it actually do
its job?* Kubernetes restarts anything failing the first, but only stops sending
traffic to anything failing the second. If `/healthz` checked the database, one
database hiccup would make Kubernetes kill every copy of the app repeatedly —
turning a small problem into a total outage.

**Why does the database use a StatefulSet?**
Because a StatefulSet can attach a disk that outlives the pod. Delete the
database pod and the data is still there when it comes back. Redis is a plain
Deployment with no disk, because a cache can be rebuilt from the database.

**Why is the image named after a commit?**
So you can always answer "which version is running?". A tag like `latest` moves,
so it can never tell you that.

**Where does the database password come from?**
Helm generates it on first install and reuses it afterwards. It is never written
in any file in this repository.

---

## What this is not

Worth being straight about, because these are real gaps and knowing them is part
of the exercise:

- **One server.** If it dies, everything dies. A production system would run
  several.
- **Local Terraform state.** The record of what has been built sits in this
  folder. A real team keeps it in shared storage so it cannot be lost.
- **No HTTPS.** Traffic is plain HTTP, because there is no domain name — you
  cannot get a certificate for a bare IP address.
- **No backups.** The database has a disk that survives restarts, but nothing is
  copied anywhere else.
- **One environment.** Real teams deploy to staging first.

Each of those is a deliberate simplification to keep the project understandable,
not something that was overlooked.
