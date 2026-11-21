# AWS deployment (S3 + CloudFront)

The current React/Vite site is static. Runtime hosting requires a private S3 bucket and CloudFront with Origin Access Control (OAC). There is no backend, database, API Gateway, Lambda, or EC2 requirement for this milestone.

## Existing AWS prerequisites

These resources are created manually and reused by both GitHub Actions workflows:

- Terraform state bucket: `deployment-tf-state-bucket` in `ap-south-1`. Keep it private and enable versioning.
- GitHub OIDC provider: `https://token.actions.githubusercontent.com`, with audience `sts.amazonaws.com`.
- IAM role: `Github-Deployment-Role`.
- The role trust policy must restrict the subject to `repo:Ashkin-Fino/Wedding-Invitation:ref:refs/heads/main` and audience to `sts.amazonaws.com`.
- Attach the infrastructure/deployment permissions policy to this role. It needs access to the state bucket, create/configure the website bucket, manage CloudFront and OAC, set the website bucket policy, upload/delete site objects, and create CloudFront invalidations.

The role ARN is:

```text
arn:aws:iam::669930664580:role/Github-Deployment-Role
```

## 1. Configure GitHub repository variables

Open **GitHub → Settings → Secrets and variables → Actions → Variables** and create:

| Variable | Value |
|---|---|
| `AWS_ROLE_ARN` | `arn:aws:iam::669930664580:role/Github-Deployment-Role` |
| `AWS_REGION` | `ap-south-1` |

After provisioning, add the remaining two:

| Variable | Value |
|---|---|
| `AWS_S3_BUCKET` | Terraform output `s3_bucket_name` |
| `AWS_CLOUDFRONT_DISTRIBUTION_ID` | Terraform output `cloudfront_distribution_id` |

These are repository variables, not secrets. No AWS access keys are needed.

## 2. Provision infrastructure

1. Open the repository's **Actions** tab.
2. Select **Provision AWS infrastructure**.
3. Click **Run workflow** on branch `main`.
4. Enter a globally unique website bucket name. Terraform creates this bucket; do not create it manually.
5. Run the workflow.

GitHub Actions assumes `Github-Deployment-Role` using OIDC, initializes Terraform with the existing state bucket, and applies the configuration. Terraform creates the private website S3 bucket, its security settings, the CloudFront distribution and OAC, and the S3 bucket policy allowing only that distribution to read website objects.

Terraform does not create or modify the manually managed OIDC provider or IAM role.

Terraform state is stored at `s3://deployment-tf-state-bucket/wedding-invitation/terraform.tfstate`, with S3 native state locking enabled.

## 3. Configure deployment variables

After the infrastructure workflow succeeds, copy `AWS_S3_BUCKET` and `AWS_CLOUDFRONT_DISTRIBUTION_ID` from the workflow summary into repository variables. Confirm `AWS_ROLE_ARN` and `AWS_REGION` are also present.

## 4. Deploy the website

1. Open **Actions → Deploy wedding invitation to AWS**.
2. Select branch `main`.
3. Keep CloudFront invalidation enabled and run the workflow.

The workflow builds the React application, syncs `dist/` to the private S3 bucket, and invalidates CloudFront.

## Security and cost notes

- Both workflows are manual-only and restricted to `main`.
- Keep both S3 buckets private. CloudFront accesses the website bucket using OAC.
- The same IAM role is used for provisioning and deployment. Its permissions are broader than a deployment-only role; restrict its trust policy to this repository and branch.
- CloudFront and S3 usage can incur charges. Review AWS pricing and consider setting a budget alert.
- The default CloudFront hostname and HTTPS certificate are used. A custom domain additionally requires DNS and an ACM certificate in `us-east-1`.
