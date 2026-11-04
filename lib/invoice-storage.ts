import type { InvoiceData, SavedClient, SavedInvoice } from "./invoice";

const CURRENT_KEY = "techgajana-invoice-current";
const HISTORY_KEY = "techgajana-invoice-history";
const CLIENTS_KEY = "techgajana-invoice-clients";
const MIGRATED_KEY = "techgajana-invoice-firebase-migrated";

export interface LegacyLocalWorkspace {
  current: InvoiceData | null;
  history: SavedInvoice[];
  clients: SavedClient[];
}

export function hasMigratedLocalData(): boolean {
  return window.localStorage.getItem(MIGRATED_KEY) === "true"
    && !window.localStorage.getItem(CURRENT_KEY)
    && !window.localStorage.getItem(HISTORY_KEY)
    && !window.localStorage.getItem(CLIENTS_KEY);
}

export function loadLegacyLocalWorkspace(): LegacyLocalWorkspace {
  return {
    current: readJson<InvoiceData>(CURRENT_KEY),
    history: readJson<SavedInvoice[]>(HISTORY_KEY) ?? [],
    clients: readJson<SavedClient[]>(CLIENTS_KEY) ?? [],
  };
}

export function markLegacyLocalDataMigrated(): void {
  window.localStorage.removeItem(CURRENT_KEY);
  window.localStorage.removeItem(HISTORY_KEY);
  window.localStorage.removeItem(CLIENTS_KEY);
  window.localStorage.setItem(MIGRATED_KEY, "true");
}

function readJson<T>(key: string): T | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error(`Unable to read legacy invoice data (${key}).`, error);
    throw new Error(`Legacy invoice data in ${key} could not be parsed.`);
  }
}
