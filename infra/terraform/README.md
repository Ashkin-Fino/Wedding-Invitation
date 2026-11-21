# AWS deployment (S3 + CloudFront)

The current React/Vite site is static. Runtime hosting requires only:
- A private S3 bucket for the Vite `dist/` files.
- CloudFront with Origin Access Control (OAC) to serve the bucket over HTTPS.

IAM and GitHub OIDC are used for deployment authentication; they are not application hosting services. There is no backend, database, API Gateway, Lambda, or EC2 requirement in this milestone. Guest wishes, gift reservations, and photo selection are browser-only demos and are not persisted/uploaded.

## Deploy without installing Terraform locally

Terraform runs in GitHub Actions. One initial AWS bootstrap step is needed because the OIDC provider and role do not exist yet.

### 1. Prepare unique bucket names

The infrastructure workflow creates two separate S3 buckets:
- A Terraform state bucket, used only to store encrypted/versioned Terraform state.
- A website bucket, used by CloudFront to serve the built React application.

You do not need to create either bucket manually. During the first workflow run, enter two globally unique bucket names. The workflow creates the state bucket first, enables public-access blocking, versioning and SSE-S3 encryption, and then initializes Terraform. Terraform creates the website bucket.

### 2. Create temporary AWS bootstrap credentials

The first Terraform run needs AWS credentials with permission to create S3, CloudFront, IAM OIDC provider, IAM role and IAM policies. Do not use root-account access keys.

For the simplest one-time bootstrap, create a dedicated IAM user/access key for this setup and grant it the required infrastructure provisioning permissions. If you temporarily attach `AdministratorAccess`, treat the key as highly privileged: store it only as GitHub Actions secrets, never paste it into workflow files, and delete/deactivate it immediately after successful provisioning and verification. A narrowly scoped custom policy is preferable.

In **GitHub → Settings → Secrets and variables → Actions → Secrets**, create:

| Name | Value |
|---|---|
| `AWS_BOOTSTRAP_ACCESS_KEY_ID` | IAM access key ID |
| `AWS_BOOTSTRAP_SECRET_ACCESS_KEY` | IAM secret access key |

These are temporary bootstrap credentials. The normal deploy workflow does not use them.

### 3. Run the infrastructure workflow

1. Open the repository's **Actions** tab.
2. Select **Provision AWS infrastructure**.
3. Click **Run workflow** and select branch `main`.
4. Enter a globally unique website bucket name and a different globally unique Terraform state bucket name.
5. Select the AWS region and run the workflow.

The workflow creates and secures the remote state bucket, installs Terraform on the GitHub-hosted runner, initializes the S3 backend, and applies the Terraform configuration. It creates:
- The private website S3 bucket and its security settings.
- The CloudFront distribution and OAC.
- The S3 bucket policy that permits only this CloudFront distribution to read website objects.
- The GitHub Actions OIDC provider.
- The restricted GitHub deployment IAM role and its S3/CloudFront permissions.

The Terraform state is stored remotely in the separate state bucket, with S3 native state locking enabled.

If your AWS account already has a GitHub OIDC provider for `token.actions.githubusercontent.com`, the apply may report that it already exists. Stop rather than deleting the existing provider; the Terraform resource must be imported into the remote state before retrying.

### 4. Add the Terraform outputs as GitHub variables

Open the successful **Provision AWS infrastructure** run and expand its summary. Copy the output values into **Settings → Secrets and variables → Actions → Variables**:

| Variable | Terraform output |
|---|---|
| `AWS_ROLE_ARN` | `github_actions_role_arn` |
| `AWS_REGION` | `aws_region` |
| `AWS_S3_BUCKET` | `s3_bucket_name` |
| `AWS_CLOUDFRONT_DISTRIBUTION_ID` | `cloudfront_distribution_id` |

These four values are repository variables, not secrets.

### 5. Deploy the website

1. Open **Actions → Deploy wedding invitation to AWS**.
2. Click **Run workflow** on branch `main`.
3. Keep CloudFront invalidation enabled and run it.

The workflow builds the React application, syncs `dist/` to the private S3 bucket, and optionally invalidates CloudFront.

After confirming the deployment succeeds using OIDC, delete/deactivate the temporary IAM access key and delete the two `AWS_BOOTSTRAP_*` GitHub secrets. Future website deployments use only the OIDC role.

The CloudFront URL is shown as the `cloudfront_domain_name` output in the infrastructure workflow summary. Initial CloudFront distribution deployment can take several minutes.

## If you already have a GitHub OIDC provider

AWS allows one OIDC provider per issuer URL in an account. If one already exists, do not create a duplicate or delete it. Import its ARN into Terraform state before applying:

```bash
terraform import aws_iam_openid_connect_provider.github arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com
```

Because Terraform is running in GitHub Actions, this import must be added as a controlled one-time workflow step or performed through another authenticated Terraform environment using the same remote state backend.

## Cost and security notes

- S3 and CloudFront are the only runtime hosting services for the current site. IAM/OIDC and the Terraform state bucket support deployment and infrastructure management.
- S3 is private; do not enable public bucket access or S3 static website hosting. CloudFront reads from S3 using OAC.
- CloudFront uses its default `cloudfront.net` hostname and certificate. A custom domain would additionally need DNS and an ACM certificate in `us-east-1`.
- Storage, requests, data transfer and invalidations can incur charges. Review AWS pricing and set a budget alert.
- Both workflows are manual-only and restricted to the `main` branch.
