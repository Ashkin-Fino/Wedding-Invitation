# AWS deployment (S3 + CloudFront)

This project is currently a static React/Vite website. The deployment uses:
- A private S3 bucket to store the Vite `dist/` output.
- CloudFront with Origin Access Control (OAC) to serve the private bucket over HTTPS.
- An IAM role assumed by GitHub Actions through GitHub OIDC. No AWS access keys are stored in GitHub.

There is no backend, database, API Gateway, Lambda, or EC2 requirement for the current frontend-only milestone. Guest wishes, gift reservations, and photo selection remain browser-only demos and are not persisted/uploaded.

## 1. Prerequisites

- AWS CLI authenticated locally with permission to create S3, CloudFront, IAM OIDC provider, IAM role and policies.
- Terraform >= 1.5 and AWS provider 5.x.
- Permission to create the GitHub OIDC provider. An account can have only one provider for this issuer.
- Choose a globally unique S3 bucket name.

## 2. Provision infrastructure

From this directory:

```bash
terraform init
terraform validate
terraform plan -var="bucket_name=your-globally-unique-bucket-name"
terraform apply -var="bucket_name=your-globally-unique-bucket-name"
```

The default bucket region is `ap-south-1` (Mumbai). Override it with `-var="aws_region=..." ` if needed.

If the GitHub Actions OIDC provider already exists in this AWS account, Terraform will report that the provider URL is already in use. Import the existing provider before applying:

```bash
terraform import aws_iam_openid_connect_provider.github arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com
```

Terraform state contains infrastructure metadata and should be kept private. Do not commit `terraform.tfstate`, state backups, or credentials. For a team workflow, configure a remote encrypted state backend with locking.

## 3. Configure GitHub repository variables

After `terraform apply`, copy the output values into **GitHub → Settings → Secrets and variables → Actions → Variables**:

| Variable | Terraform output |
|---|---|
| `AWS_ROLE_ARN` | `github_actions_role_arn` |
| `AWS_REGION` | `aws_region` |
| `AWS_S3_BUCKET` | `s3_bucket_name` |
| `AWS_CLOUDFRONT_DISTRIBUTION_ID` | `cloudfront_distribution_id` |

These are repository **variables**, not secrets. The workflow uses OIDC and does not need AWS access-key secrets.

The IAM trust policy only permits this repository's `main` branch to assume the deployment role.

## 4. Deploy manually

1. Push the code and workflow to `main`.
2. Open the repository's **Actions** tab.
3. Select **Deploy wedding invitation to AWS**.
4. Click **Run workflow**, select `main`, and run it.
5. Keep CloudFront invalidation enabled to make the latest assets visible immediately.

The workflow installs dependencies, runs `npm run build`, syncs `dist/` to S3 (removing obsolete files), and optionally invalidates CloudFront.

After the first deployment, open the `cloudfront_domain_name` Terraform output. CloudFront may take several minutes to finish its initial deployment.

## 5. Cost and security notes

- S3 and CloudFront are the only runtime hosting services required for this static site. AWS also has IAM resources for deployment permissions; IAM/OIDC is not an application server.
- S3 is private; do not enable static website hosting or public bucket access. CloudFront reads from S3 using OAC.
- CloudFront uses its free `cloudfront.net` hostname and default certificate. A custom domain would additionally need DNS and an ACM certificate in `us-east-1`.
- Charges can still apply for storage, requests, data transfer, and invalidations beyond applicable free allowances. Review current AWS pricing and budgets before deploying.
- The workflow is manual-only and restricted to `main`.
