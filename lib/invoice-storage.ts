import type { InvoiceData, SavedClient, SavedInvoice, StoredAsset } from "./invoice";

const ASSET_DB = "techgajana-invoice-assets";
const ASSET_STORE = "assets";
const CURRENT_KEY = "techgajana-invoice-current";
const HISTORY_KEY = "techgajana-invoice-history";
const CLIENTS_KEY = "techgajana-invoice-clients";
const SEQUENCE_KEY = "techgajana-invoice-sequence";
const MIGRATED_KEY = "techgajana-invoice-firebase-migrated";

function openAssetDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ASSET_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(ASSET_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open local file storage."));
  });
}

export async function saveAsset(file: File): Promise<StoredAsset> {
  const id = crypto.randomUUID();
  const db = await openAssetDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(ASSET_STORE, "readwrite");
    transaction.objectStore(ASSET_STORE).put(file, id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Unable to save uploaded file."));
    transaction.onabort = () => reject(transaction.error ?? new Error("File storage was interrupted."));
  });
  db.close();
  return { id, name: file.name, type: file.type };
}

export async function loadAsset(id: string): Promise<Blob | undefined> {
  const db = await openAssetDb();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const request = db.transaction(ASSET_STORE, "readonly").objectStore(ASSET_STORE).get(id);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error ?? new Error("Unable to load an uploaded file."));
  });
  db.close();
  return blob;
}

export async function deleteAsset(id: string): Promise<void> {
  const db = await openAssetDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(ASSET_STORE, "readwrite");
    transaction.objectStore(ASSET_STORE).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Unable to remove uploaded file."));
  });
  db.close();
}

export function loadCurrent(): InvoiceData | null {
  return readJson<InvoiceData>(CURRENT_KEY);
}

export function saveCurrent(invoice: InvoiceData): void {
  window.localStorage.setItem(CURRENT_KEY, JSON.stringify(invoice));
}

export function loadHistory(): SavedInvoice[] {
  return readJson<SavedInvoice[]>(HISTORY_KEY) ?? [];
}

export function saveHistory(history: SavedInvoice[]): void {
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export function loadClients(): SavedClient[] {
  return readJson<SavedClient[]>(CLIENTS_KEY) ?? [];
}

export function saveClients(clients: SavedClient[]): void {
  window.localStorage.setItem(CLIENTS_KEY, JSON.stringify(clients));
}

export function hasMigratedLocalData(): boolean {
  return window.localStorage.getItem(MIGRATED_KEY) === "true";
}

export function markLocalDataMigrated(): void {
  window.localStorage.setItem(MIGRATED_KEY, "true");
}

export function getNextInvoiceNumber(): string {
  const year = new Date().getFullYear();
  const stored = Number(window.localStorage.getItem(`${SEQUENCE_KEY}-${year}`) ?? "1");
  return `TG-INV-${year}-${String(Math.max(1, stored)).padStart(3, "0")}`;
}

export function advanceInvoiceSequence(invoiceNumber: string): void {
  const match = invoiceNumber.match(/^TG-INV-(\d{4})-(\d+)$/);
  if (!match) {
    return;
  }
  const sequenceKey = `${SEQUENCE_KEY}-${match[1]}`;
  const current = Number(window.localStorage.getItem(sequenceKey) ?? "1");
  window.localStorage.setItem(sequenceKey, String(Math.max(current, Number(match[2]) + 1)));
}

function readJson<T>(key: string): T | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error(`Unable to read saved invoice data (${key}).`, error);
    return null;
  }
}
