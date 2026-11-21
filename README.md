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
- Wishes, gift reservations and photo selection are frontend demonstrations only. They do not persist or transmit data yet.

## Deploy to AWS
Run `npm run build`, then upload the contents of `dist/` to an S3 bucket configured for private origin access through CloudFront. Set the CloudFront default root object to `index.html`. Backend APIs, private photo uploads and durable gift reservations are planned for later milestones.
