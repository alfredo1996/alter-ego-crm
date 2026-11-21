# Deploy Your Own

Alter Ego CRM is a Next.js app that runs on a Firebase project (Firestore, Authentication and
Storage). Any host that runs Next.js works; these are the steps for **Firebase App Hosting**,
with `NEXT_PUBLIC_BACKEND=firebase`.

## Before you start

- A Firebase project with **Firestore**, **Authentication** (Email/Password) and **Storage**
  enabled (Storage holds the invoice files).
- The Firebase CLI: `npm i -g firebase-tools && firebase login`.
- Your own project id. Everything in the repository that says `demo-alter-ego` is a
  placeholder for it (`.firebaserc`, `apps/web/apphosting.yaml`).

## Steps

```bash
# 1. Create the App Hosting backend (links your GitHub repository to Cloud Run).
#    Set its root directory to apps/web: App Hosting reads apphosting.yaml from there.
firebase apphosting:backends:create --project YOUR_PROJECT_ID

# 2. Store the sensitive variables as secrets
firebase apphosting:secrets:set FIREBASE_API_KEY --project YOUR_PROJECT_ID
firebase apphosting:secrets:set FIREBASE_MESSAGING_SENDER_ID --project YOUR_PROJECT_ID
firebase apphosting:secrets:set FIREBASE_APP_ID --project YOUR_PROJECT_ID

# 3. Put your project id, auth domain and public origin in apps/web/apphosting.yaml,
#    and your origin in cors.json

# 4. Deploy the security rules and indexes (Firestore and Storage)
pnpm rules:build
firebase deploy --only firestore:rules,firestore:indexes,storage --project YOUR_PROJECT_ID

# 5. Let the app read invoice files from your origin
gcloud storage buckets update gs://YOUR_PROJECT_ID.firebasestorage.app --cors-file=cors.json
```

## Which plugins run

Every area is a plugin (`finance`, `consulting`, `accounting`, `rent`). List the ones to run in
`NEXT_PUBLIC_PLUGINS` in `apphosting.yaml`, for example `consulting,accounting` or `finance` alone; `consulting,accounting,rent` run when it is
unset, and `finance`, like a plugin added later, is never on until it is listed. A plugin that needs another one (accounting needs consulting, rent needs accounting; finance needs none) fails the build
when that one is not listed, and so does an unknown id. Settings lists what a deployment runs.

## Who can sign in

Sign-up is closed: the rules admit one user id, `isAllowedUser` in `firestore/base.rules`
(and `storage.rules`), mirrored in `apps/web/src/lib/owner-uid.ts`. Create your user in the
Firebase console (Authentication), then put its uid in all three places and run
`pnpm rules:build`.

## Notes

- **MCP server:** set `MCP_PUBLIC_ORIGIN` in `apphosting.yaml` to the canonical public
  origin. It is also the OAuth issuer, so it must match the URL the connector uses.
- **Custom domain:** `firebase apphosting:domains` or the console.
- **Local and self-hosted:** see [SELF-HOSTING.md](SELF-HOSTING.md).
