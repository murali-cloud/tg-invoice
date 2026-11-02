# TechGajana Invoice Studio

A shared invoice workspace for creating, previewing, saving, and printing invoices for TechGajana Private Limited. Invoice drafts, saved history, reusable clients, and uploaded files sync through Firebase.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Run `npm run lint`, `npx tsc --noEmit`, and `npm run build` to validate changes.

## Invoice workflow

- Edit company, client, invoice, line-item, payment, bank, and terms information in the editor. The A4 preview updates as you type.
- Use the GST switch to include or exclude GST from calculations and the invoice table. Turning GST off hides the GST column and preserves each item's saved rate for when it is turned back on. Line-item discounts still affect totals but are not shown in the invoice table.
- Sign in with an administrator-provisioned Firebase Email/Password account. There is no public account registration.
- Active drafts sync privately per account; saved invoice history and reusable client details are shared across the company workspace. Existing localStorage data is merged into Firebase at first sign-in.
- Logo, signature, stamp, QR code, and payment proof files sync to Firebase Storage. Existing IndexedDB files are uploaded during the first sign-in migration.
- Select **Download PDF** to download an A4 PDF made from the same invoice preview shown on screen. Longer invoices are split across pages, and the filename includes the invoice number and client name.
- Each uploaded payment receipt appears on its own page after the invoice in both the preview and the downloaded PDF. Image receipts are included; PDF receipts appear as named attachment references.

## Firebase setup

1. Create a Firebase project and register a web app. Enable Email/Password in Authentication, create a Firestore database, and create a Storage bucket.
2. Copy `.env.example` to `.env.local` and fill in the Firebase web app configuration from Project settings. Restart the Next.js server after changing environment values.
3. Deploy `firestore.rules` and `storage.rules` from the Firebase console, or with the Firebase CLI using `firebase deploy --only firestore:rules,storage`.
4. Create each team member in Firebase Authentication. In Firestore, add a document at `workspaces/techgajana/members/{uid}` using that account's UID as the document ID. The app grants access only to these members.

Firebase web app configuration is public client configuration; Firestore and Storage rules enforce access. Never weaken the rules to public read/write. Browser storage remains as a local migration source and cache, but Firebase is the shared source of truth.
