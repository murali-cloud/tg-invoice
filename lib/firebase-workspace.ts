import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";
import { getBlob, ref, uploadBytes } from "firebase/storage";
import type { InvoiceData, SavedClient, SavedInvoice, StoredAsset } from "./invoice";
import { firestore, firebaseStorage } from "./firebase";
import { loadAsset } from "./invoice-storage";

const WORKSPACE_ID = "techgajana";

export interface CloudWorkspace {
  current: InvoiceData | null;
  history: SavedInvoice[];
  clients: SavedClient[];
}

function requireFirestore() {
  if (!firestore) throw new Error("Firebase is not configured.");
  return firestore;
}

function requireStorage() {
  if (!firebaseStorage) throw new Error("Firebase is not configured.");
  return firebaseStorage;
}

function workspaceCollection(name: "invoices" | "clients") {
  return collection(requireFirestore(), "workspaces", WORKSPACE_ID, name);
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

function assetReferences(invoice: InvoiceData): StoredAsset[] {
  return [
    invoice.company.logo,
    invoice.company.signature,
    invoice.company.stamp,
    invoice.bank.qrCode,
    ...invoice.payment.proofs,
  ].filter((asset): asset is StoredAsset => Boolean(asset));
}

export async function getCloudWorkspace(userId: string): Promise<CloudWorkspace> {
  const database = requireFirestore();
  const [currentSnapshot, invoiceSnapshot, clientSnapshot] = await Promise.all([
    getDoc(doc(database, "workspaces", WORKSPACE_ID, "drafts", userId)),
    getDocs(query(workspaceCollection("invoices"), orderBy("savedAt", "desc"))),
    getDocs(query(workspaceCollection("clients"), orderBy("name"))),
  ]);

  return {
    current: currentSnapshot.exists() ? currentSnapshot.data().data as InvoiceData : null,
    history: invoiceSnapshot.docs.map((entry) => entry.data() as SavedInvoice),
    clients: clientSnapshot.docs.map((entry) => entry.data() as SavedClient),
  };
}

export async function migrateLocalWorkspace(local: CloudWorkspace, userId: string): Promise<CloudWorkspace> {
  const cloud = await getCloudWorkspace(userId);
  const knownInvoices = new Set(cloud.history.map((entry) => entry.id));
  const knownClients = new Set(cloud.clients.map((entry) => entry.id));
  const pendingWrites: Promise<void>[] = [];

  if (!cloud.current && local.current) pendingWrites.push(saveCloudCurrent(userId, local.current));
  for (const invoice of local.history) {
    if (!knownInvoices.has(invoice.id)) pendingWrites.push(saveCloudInvoice(invoice));
  }
  for (const client of local.clients) {
    if (!knownClients.has(client.id)) pendingWrites.push(saveCloudClient(client));
  }

  const assetRefs = [
    ...(local.current ? assetReferences(local.current) : []),
    ...local.history.flatMap((invoice) => assetReferences(invoice.data)),
  ];
  await Promise.all([...new Map(assetRefs.map((asset) => [asset.id, asset])).values()].map(async (asset) => {
    const blob = await loadAsset(asset.id);
    if (blob) await uploadCloudAsset(asset.id, blob, asset.type);
  }));
  await Promise.all(pendingWrites);
  return getCloudWorkspace(userId);
}

export function watchCloudWorkspace(
  userId: string,
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
    doc(database, "workspaces", WORKSPACE_ID, "drafts", userId),
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

export async function saveCloudCurrent(userId: string, invoice: InvoiceData): Promise<void> {
  await setDoc(doc(requireFirestore(), "workspaces", WORKSPACE_ID, "drafts", userId), { data: withoutUndefined(invoice) });
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

export async function uploadCloudAsset(id: string, file: Blob, contentType: string): Promise<void> {
  await uploadBytes(ref(requireStorage(), `assets/${id}`), file, { contentType });
}

export async function loadCloudAsset(id: string): Promise<Blob> {
  return getBlob(ref(requireStorage(), `assets/${id}`));
}