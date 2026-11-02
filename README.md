# TechGajana Invoice Studio

A client-side invoice workspace for creating, previewing, saving, and printing invoices for TechGajana Private Limited.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Run `npm run lint`, `npx tsc --noEmit`, and `npm run build` to validate changes.

## Invoice workflow

- Edit company, client, invoice, line-item, payment, bank, and terms information in the editor. The A4 preview updates as you type.
- Use the GST switch to include or exclude GST from calculations and the invoice table. Turning GST off hides the GST column and preserves each item's saved rate for when it is turned back on. Line-item discounts still affect totals but are not shown in the invoice table.
- Save drafts and reusable client details in this browser. Invoice numbers are generated from a per-year local sequence; manually entered duplicate numbers are rejected when saving.
- Logo, signature, stamp, QR code, and payment proof files are stored in IndexedDB. Invoice details and draft history are stored in localStorage. No invoice data is sent to a server.
- Select **Download PDF** to download an A4 PDF made from the same invoice preview shown on screen. Longer invoices are split across pages, and the filename includes the invoice number and client name.
- Each uploaded payment receipt appears on its own page after the invoice in both the preview and the downloaded PDF. Image receipts are included; PDF receipts appear as named attachment references.

Browser storage is local to the current browser profile. Clearing site data removes saved invoices and uploaded assets.
