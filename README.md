# Ashkin & Yesodhaa — Wedding Invitation

A mobile-first, eight-section wedding invitation built with React, Vite, Framer Motion and Lucide icons. The visual direction is **Royal Elegance**: warm ivory, antique gold, deep maroon and editorial serif typography.

## Run locally
```bash
npm install
npm run dev
```

## Production build
```bash
npm run build
npm run preview
```

## Customize before publishing
Update `src/config.js` with the final wedding date/time, ceremony and reception schedule, venue/address/map link, story details, image URLs and licensed background music URL. The current date, venue and story copy are clearly placeholders. Replace sample Unsplash images with your own optimized photographs.

## Milestone 1 functionality
- Responsive hero, story timeline, live countdown, event details, guest wishes, photo selection, gift ideas and thank-you sections.
- Smooth section navigation, scroll progress, reveal animations and an optional user-controlled music player.
- Guest wishes and gift reservations are backed by the existing Lambda and DynamoDB table. The gift catalogue is maintained in the backend `gifts.json` file and served to the frontend by the API.

## Deploy to AWS
Run `npm run build`, then upload the contents of `dist/` to an S3 bucket configured for private origin access through CloudFront. Set the CloudFront default root object to `index.html`. The wishes API is provisioned through Terraform; private photo uploads and durable gift reservations are planned for later milestones.


## Guest wishes backend

Guest wishes are served by a Python 3.12 Lambda Function URL behind the existing CloudFront distribution. CloudFront uses Origin Access Control (OAC) with SigV4; the Function URL uses `AWS_IAM` and grants invocation only to this distribution. The public API is available at the same origin as the website:

- `GET /api/wishes` — returns the latest 50 approved wishes.
- `POST /api/wishes` — validates and automatically publishes a wish.

The Lambda uses one DynamoDB table (`ashkin-yesodhaa-wedding-wishes`) with provisioned capacity (5 RCU / 10 WCU for the table and 10 RCU / 10 WCU for its status index), no autoscaling, 128 MB memory and a 3-second timeout. It uses the account's unreserved Lambda concurrency so deployment does not reserve capacity needed by other functions. The approved-wishes GET response is cached at CloudFront for 30 seconds; POST requests are not cached. A per-IP limit allows up to 10 submissions in a 10-minute window. The hashed rate-limit keys expire automatically. Request bodies are limited to 2 KB; names to 50 characters and messages to 400 characters.

### Approving wishes

New valid wishes are stored directly with `status = APPROVED` and `gsi1pk = STATUS#APPROVED`, so they are eligible for the public feed immediately. To remove an unwanted wish, delete its item from the DynamoDB table. The feed can take up to 30 seconds to reflect a deletion because the GET response is briefly cached at CloudFront. Do not change the table keys.
### Gift catalogue and reservations

The gift list is owned by `backend/wedding_invitation_lambda/gifts.json`. The frontend does not maintain a separate gift list. The Lambda returns each catalogue entry together with its current reservation status from DynamoDB through `GET /api/gifts`.

To add or edit a gift, update `gifts.json` and commit the change. Each gift must have a unique, stable `id`, plus `name`, `detail`, and `image` fields. Use an image path or HTTPS image URL that is accessible to the website. Then run the existing **Provision AWS infrastructure** workflow to package and deploy the updated Lambda catalogue. A frontend deployment is not needed for catalogue-only changes; run **Deploy wedding invitation to AWS** only when you also change frontend code or static assets.

DynamoDB stores reservation state, not duplicate catalogue metadata. An available gift has no reservation item yet; its status is derived as `AVAILABLE`. A reservation item is created only when a guest reserves that gift. This is why the table may contain one gift item even while the catalogue contains several gifts.

### Local frontend development

After the API infrastructure has been provisioned, create an untracked `.env.local` file in the repository root:

```dotenv
VITE_API_PROXY_TARGET=https://YOUR_CLOUDFRONT_DOMAIN
```

Replace the value with the CloudFront domain from the Terraform output. Vite will proxy local `/api/*` requests through CloudFront, so the browser does not need AWS credentials. Restart `npm run dev` after creating or changing this file.

### Provisioning

The existing **Provision AWS infrastructure** GitHub Actions workflow also updates the existing CloudFront distribution and creates the wishes resources. When running it again, enter the exact existing website bucket name (the value of the repository variable `AWS_S3_BUCKET`) so Terraform continues managing the same site bucket. The GitHub OIDC role must be allowed to manage the new DynamoDB table, Lambda function and Function URL, Lambda execution role/policy, CloudWatch log group, and CloudFront OAC/origin request policy in addition to its existing website permissions.

The Function URL is not intended to be called directly. Do not change its authentication type to `NONE`, and do not add a public Lambda invoke permission. The API is same-origin, so no browser CORS allowlist is needed.
