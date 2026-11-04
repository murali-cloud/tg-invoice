# TechGajana Invoice Studio

A shared invoice workspace for creating, previewing, saving, and printing invoices for TechGajana Private Limited. Invoice drafts, saved history, and reusable clients are stored in Firestore.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Run `npm run lint`, `npx tsc --noEmit`, and `npm run build` to validate changes.

## Invoice workflow

- Enter the client name, billing address, and optional GSTIN, then add invoice dates and software services. Company identity is fixed in code rather than editable for each invoice.
- Record each project payment with its amount and date. The first is marked as the advance; add milestone payments as the project progresses. The invoice totals payments received and shows the remaining balance.
- Set the company name, address, CIN, contact number, signature, and seal in `COMPANY_IDENTITY` in `lib/invoice.ts`. Add signature/seal images under `public/` and set `signatureSrc` and `sealSrc` to their paths (for example, `/company-signature.png`).
- Use the GST switch to include or exclude GST from calculations and the invoice table. Turning GST off hides the GST column and preserves each item's saved rate for when it is turned back on. Line-item discounts still affect totals but are not shown in the invoice table.
- No sign-in is required. One current draft, saved invoice history, and reusable client details are shared with anyone who can access the app. Concurrent edits to the shared draft can overwrite one another.
- Existing local invoice drafts, history, and clients are migrated to Firestore once, then removed from localStorage. If Firestore is unavailable, the workspace does not fall back to local business-data storage.
- Select **Download PDF** to generate and download an A4 PDF in the browser. PDFs are not uploaded or stored by the app. Longer invoices are split across pages, and the filename includes the invoice number and client name.

## Firebase setup

1. Create a Firebase project and register a web app. Create a Firestore database. Authentication is not used.
2. Copy `.env.example` to `.env.local` and fill in the Firebase web app configuration from Project settings. Restart the Next.js server after changing environment values.
3. Deploy `firestore.rules` from the Firebase console, or with the Firebase CLI using `firebase deploy --only firestore:rules`.

**Public access warning:** The deployed rules allow anyone to read, add, change, or delete workspace invoices, drafts, clients, and invoice counters. The app URL and Firebase web configuration are not access controls. Do not use this setup for sensitive or confidential data. Firestore is the only ongoing store for invoice and client data; localStorage is used only to read and migrate legacy records once.
