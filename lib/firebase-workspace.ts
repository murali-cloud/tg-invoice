import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
} from "firebase/firestore";
import { createDefaultInvoice } from "./invoice";
import type { InvoiceData, PaymentDetails, SavedClient, SavedInvoice } from "./invoice";
import { firestore } from "./firebase";

const WORKSPACE_ID = "techgajana";
const CURRENT_DRAFT_ID = "current";
const CURRENT_INVOICE_ID = "current";
const INVOICE_COUNTER_PREFIX = "invoice-";

export interface CloudWorkspace {
  current: InvoiceData | null;
  history: SavedInvoice[];
  clients: SavedClient[];
}

function requireFirestore() {
  if (!firestore) throw new Error("Firebase is not configured.");
  return firestore;
}

function workspaceCollection(name: "invoices" | "clients") {
  return collection(requireFirestore(), "workspaces", WORKSPACE_ID, name);
}

function invoiceSequence(invoiceNumber: string, year: number): number {
  const match = invoiceNumber.match(/^TG-INV-(\d{4})-(\d+)$/);
  return match && Number(match[1]) === year ? Number(match[2]) : 0;
}

function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutUndefined) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, field]) => field !== undefined)
        .map(([key, field]) => [key, withoutUndefined(field)]),
    ) as T;
  }
  return value;
}

function parseInvoice(value: unknown): InvoiceData | null {
  if (!value || typeof value !== "object") return null;
  const document = value as Record<string, unknown>;
  const raw = (document.data && typeof document.data === "object" ? document.data : document) as Partial<InvoiceData>;
  const date = typeof raw.details?.date === "string" ? raw.details.date : new Date().toISOString().slice(0, 10);
  const defaults = createDefaultInvoice(typeof raw.details?.number === "string" ? raw.details.number : "", date);
  const rawPayment = raw.payment as Partial<PaymentDetails> | undefined;
  const payments = Array.isArray(rawPayment?.payments)
    ? rawPayment.payments
    : rawPayment && typeof rawPayment.advance === "number"
      ? [{ id: "advance-payment", label: "Advance", amount: rawPayment.advance, date: rawPayment.date ?? date }]
      : defaults.payment.payments ?? [];

  return {
    ...defaults,
    ...raw,
    company: { ...defaults.company, ...raw.company },
    client: { ...defaults.client, ...raw.client },
    details: { ...defaults.details, ...raw.details },
    items: Array.isArray(raw.items) ? raw.items : defaults.items,
    payment: { ...defaults.payment, ...rawPayment, payments },
    bank: { ...defaults.bank, ...raw.bank },
    terms: Array.isArray(raw.terms) ? raw.terms : defaults.terms,
  };
}

export async function getCloudWorkspace(): Promise<CloudWorkspace> {
  const database = requireFirestore();
  const draftRef = doc(database, "workspaces", WORKSPACE_ID, "drafts", CURRENT_DRAFT_ID);
  const invoiceRef = doc(database, "workspaces", WORKSPACE_ID, "invoice", CURRENT_INVOICE_ID);
  const [currentSnapshot, invoiceSnapshot, savedInvoiceSnapshot, clientSnapshot] = await Promise.all([
    getDoc(draftRef),
    getDoc(invoiceRef),
    getDocs(query(workspaceCollection("invoices"), orderBy("savedAt", "desc"))),
    getDocs(query(workspaceCollection("clients"), orderBy("name"))),
  ]);

  let current = parseInvoice(currentSnapshot.exists() ? currentSnapshot.data() : null);
  if (!current && invoiceSnapshot.exists()) {
    current = parseInvoice(invoiceSnapshot.data());
    if (current) {
      await setDoc(draftRef, { data: withoutUndefined(current) });
      await deleteDoc(invoiceRef);
    }
  }

  return {
    current,
    history: savedInvoiceSnapshot.docs.map((entry) => entry.data() as SavedInvoice),
    clients: clientSnapshot.docs.map((entry) => entry.data() as SavedClient),
  };
}

export async function migrateLocalWorkspace(local: CloudWorkspace): Promise<CloudWorkspace> {
  const cloud = await getCloudWorkspace();
  const knownInvoices = new Set(cloud.history.map((entry) => entry.id));
  const knownClients = new Set(cloud.clients.map((entry) => entry.id));
  const pendingWrites: Promise<void>[] = [];
  const shouldMigrateCurrent = !cloud.current && Boolean(local.current);

  if (shouldMigrateCurrent && local.current) pendingWrites.push(saveCloudCurrent(local.current));
  for (const invoice of local.history) {
    if (!knownInvoices.has(invoice.id)) pendingWrites.push(saveCloudInvoice(invoice));
  }
  for (const client of local.clients) {
    if (!knownClients.has(client.id)) pendingWrites.push(saveCloudClient(client));
  }

  await Promise.all(pendingWrites);
  return getCloudWorkspace();
}

export async function reserveNextInvoiceNumber(existingInvoiceNumbers: string[]): Promise<string> {
  const year = new Date().getFullYear();
  const counterRef = doc(requireFirestore(), "workspaces", WORKSPACE_ID, "counters", `${INVOICE_COUNTER_PREFIX}${year}`);
  const highestExistingSequence = existingInvoiceNumbers.reduce(
    (highest, number) => Math.max(highest, invoiceSequence(number, year)),
    0,
  );
  const nextSequence = await runTransaction(requireFirestore(), async (transaction) => {
    const snapshot = await transaction.get(counterRef);
    const lastSequence = typeof snapshot.data()?.lastSequence === "number" ? snapshot.data()?.lastSequence as number : 0;
    const next = Math.max(lastSequence, highestExistingSequence) + 1;
    transaction.set(counterRef, { lastSequence: next });
    return next;
  });
  return `TG-INV-${year}-${String(nextSequence).padStart(3, "0")}`;
}

export function watchCloudWorkspace(
  onChange: (workspace: CloudWorkspace) => void,
  onError: (error: Error) => void,
): () => void {
  const database = requireFirestore();
  const state: CloudWorkspace = { current: null, history: [], clients: [] };
  const loaded = { current: false, history: false, clients: false };
  const emit = () => {
    if (loaded.current && loaded.history && loaded.clients) onChange(state);
  };

  const stopCurrent = onSnapshot(
    doc(database, "workspaces", WORKSPACE_ID, "drafts", CURRENT_DRAFT_ID),
    (snapshot) => {
      state.current = snapshot.exists() ? snapshot.data().data as InvoiceData : null;
      loaded.current = true;
      emit();
    },
    onError,
  );
  const stopHistory = onSnapshot(
    query(workspaceCollection("invoices"), orderBy("savedAt", "desc")),
    (snapshot) => {
      state.history = snapshot.docs.map((entry) => entry.data() as SavedInvoice);
      loaded.history = true;
      emit();
    },
    onError,
  );
  const stopClients = onSnapshot(
    query(workspaceCollection("clients"), orderBy("name")),
    (snapshot) => {
      state.clients = snapshot.docs.map((entry) => entry.data() as SavedClient);
      loaded.clients = true;
      emit();
    },
    onError,
  );

  return () => {
    stopCurrent();
    stopHistory();
    stopClients();
  };
}

export async function saveCloudCurrent(invoice: InvoiceData): Promise<void> {
  await setDoc(doc(requireFirestore(), "workspaces", WORKSPACE_ID, "drafts", CURRENT_DRAFT_ID), { data: withoutUndefined(invoice) });
}

export async function saveCloudInvoice(invoice: SavedInvoice): Promise<void> {
  await setDoc(doc(workspaceCollection("invoices"), invoice.id), withoutUndefined(invoice));
}

export async function deleteCloudInvoice(id: string): Promise<void> {
  await deleteDoc(doc(workspaceCollection("invoices"), id));
}

export async function saveCloudClient(client: SavedClient): Promise<void> {
  await setDoc(doc(workspaceCollection("clients"), client.id), withoutUndefined(client));
}