export type TaxType = "IGST" | "CGST + SGST";
export type DiscountType = "percent" | "amount";
export type InvoiceType = "Tax Invoice" | "Invoice" | "Proforma Invoice";
export type PaymentMethod = "UPI" | "Bank Transfer" | "Cash" | "Other";

export const COMPANY_IDENTITY = {
  name: "TechGajana Private Limited",
  address: "Thiruvaluvar street, Near MGR statue, Villianur, Puducherry - 605110",
  cin: "U62099PY2026PT009675",
  contact: "9486361101",
  signatureSrc: "/techgajana-signature.png",
  sealSrc: "",
} as const;

const PAYMENT_SCHEDULE_TERM = "The remaining balance is payable as agreed in the project payment schedule.";

export interface StoredAsset {
  id: string;
  name: string;
  type: string;
}

export interface CompanyDetails {
  name: string;
  businessType: string;
  email: string;
  address: string;
  phone: string;
  website: string;
  gstin: string;
  pan: string;
  signatory: string;
  designation: string;
  logo?: StoredAsset;
  signature?: StoredAsset;
  stamp?: StoredAsset;
}

export interface ClientDetails {
  name: string;
  contact: string;
  address: string;
  email: string;
  phone: string;
  gstin: string;
  state: string;
  placeOfSupply: string;
}

export interface InvoiceItem {
  id: string;
  description: string;
  project: string;
  quantity: number;
  unit: string;
  rate: number;
  discountType: DiscountType;
  discount: number;
  taxPercent: number;
  taxType: TaxType;
}

export interface InvoiceDetails {
  number: string;
  date: string;
  type: InvoiceType;
  currency: string;
  placeOfSupply: string;
  reverseCharge: boolean;
  purchaseOrder: string;
}

export interface PaymentDetails {
  payments?: PaymentEntry[];
  advance: number;
  date: string;
  method: PaymentMethod;
  transactionId: string;
  proofs: StoredAsset[];
}

export interface PaymentEntry {
  id: string;
  label: string;
  amount: number;
  date: string;
}

export interface BankDetails {
  accountHolder: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  upiId: string;
  qrCode?: StoredAsset;
}

export interface InvoiceData {
  company: CompanyDetails;
  client: ClientDetails;
  details: InvoiceDetails;
  items: InvoiceItem[];
  gstEnabled?: boolean;
  additionalCharges: number;
  roundOff: number;
  payment: PaymentDetails;
  bank: BankDetails;
  terms: string[];
}

export interface InvoiceTotals {
  lineTotal: number;
  discount: number;
  taxable: number;
  tax: number;
  igst: number;
  cgst: number;
  sgst: number;
  grandTotal: number;
  balanceDue: number;
  status: "Unpaid" | "Partially Paid" | "Paid";
}

export interface SavedInvoice {
  id: string;
  savedAt: string;
  data: InvoiceData;
}

export interface SavedClient {
  id: string;
  name: string;
  details: ClientDetails;
}

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createDefaultInvoice(invoiceNumber: string, today: string): InvoiceData {
  return {
    company: {
      name: COMPANY_IDENTITY.name,
      businessType: "Software Development & IT Services",
      email: "techgajana@gmail.com",
      address: COMPANY_IDENTITY.address,
      phone: "",
      website: "",
      gstin: "",
      pan: "",
      signatory: "",
      designation: "",
    },
    client: {
      name: "",
      contact: "",
      address: "",
      email: "",
      phone: "",
      gstin: "",
      state: "",
      placeOfSupply: "",
    },
    details: {
      number: invoiceNumber,
      date: today,
      type: "Invoice",
      currency: "INR",
      placeOfSupply: "",
      reverseCharge: false,
      purchaseOrder: "",
    },
    items: [
      {
        id: "initial-item",
        description: "Custom Software Development",
        project: "",
        quantity: 1,
        unit: "Project",
        rate: 0,
        discountType: "percent",
        discount: 0,
        taxPercent: 0,
        taxType: "IGST",
      },
    ],
    gstEnabled: true,
    additionalCharges: 0,
    roundOff: 0,
    payment: {
      payments: [{ id: "advance-payment", label: "Advance", amount: 0, date: today }],
      advance: 0,
      date: today,
      method: "UPI",
      transactionId: "",
      proofs: [],
    },
    bank: {
      accountHolder: "",
      bankName: "",
      accountNumber: "",
      ifsc: "",
      upiId: "",
    },
    terms: [
      "Payments received will be adjusted against the invoice total.",
      PAYMENT_SCHEDULE_TERM,
      "Any additional features, modifications, or services outside the agreed scope will be charged separately.",
    ],
  };
}

export function normalizeInvoiceTerms(terms: string[]): string[] {
  return terms.map((term) => (
    term.trim().replace(/[.!?]+$/, "").toLowerCase() === "the remaining balance must be paid on or before the due date"
      ? PAYMENT_SCHEDULE_TERM
      : term
  ));
}

export function calculateTotals(invoice: InvoiceData): InvoiceTotals {
  const gstEnabled = invoice.gstEnabled !== false;
  let lineTotal = 0;
  let discount = 0;
  let taxable = 0;
  let tax = 0;
  let igst = 0;
  let cgst = 0;
  let sgst = 0;

  for (const item of invoice.items) {
    const line = Math.max(0, item.quantity) * Math.max(0, item.rate);
    const itemDiscount = Math.min(
      line,
      item.discountType === "percent" ? line * Math.max(0, item.discount) / 100 : Math.max(0, item.discount),
    );
    const itemTaxable = Math.max(0, line - itemDiscount);
    const itemTax = gstEnabled ? itemTaxable * Math.max(0, item.taxPercent) / 100 : 0;

    lineTotal += line;
    discount += itemDiscount;
    taxable += itemTaxable;
    tax += itemTax;
    if (item.taxType === "IGST") {
      igst += itemTax;
    } else {
      cgst += itemTax / 2;
      sgst += itemTax / 2;
    }
  }

  const grandTotal = Math.max(
    0,
    taxable + tax + Math.max(0, invoice.additionalCharges) + invoice.roundOff,
  );
  const amountPaid = getPaymentEntries(invoice.payment).reduce((sum, payment) => sum + Math.max(0, payment.amount), 0);
  const balanceDue = Math.max(0, grandTotal - amountPaid);
  const status = grandTotal > 0 && balanceDue === 0
    ? "Paid"
    : amountPaid > 0
      ? "Partially Paid"
      : "Unpaid";

  return {
    lineTotal: roundCurrency(lineTotal),
    discount: roundCurrency(discount),
    taxable: roundCurrency(taxable),
    tax: roundCurrency(tax),
    igst: roundCurrency(igst),
    cgst: roundCurrency(cgst),
    sgst: roundCurrency(sgst),
    grandTotal: roundCurrency(grandTotal),
    balanceDue: roundCurrency(balanceDue),
    status,
  };
}

export function getPaymentEntries(payment: PaymentDetails): PaymentEntry[] {
  if (payment.payments?.length) {
    return payment.payments;
  }
  return [{
    id: "advance-payment",
    label: "Advance",
    amount: payment.advance,
    date: payment.date,
  }];
}

export function itemAmounts(item: InvoiceItem, gstEnabled = true) {
  const lineTotal = Math.max(0, item.quantity) * Math.max(0, item.rate);
  const discount = Math.min(
    lineTotal,
    item.discountType === "percent" ? lineTotal * Math.max(0, item.discount) / 100 : Math.max(0, item.discount),
  );
  const taxable = Math.max(0, lineTotal - discount);
  const tax = gstEnabled ? taxable * Math.max(0, item.taxPercent) / 100 : 0;

  return {
    lineTotal: roundCurrency(lineTotal),
    discount: roundCurrency(discount),
    taxable: roundCurrency(taxable),
    tax: roundCurrency(tax),
    total: roundCurrency(taxable + tax),
  };
}

export function formatCurrency(amount: number, currency = "INR"): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function roundCurrency(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}
