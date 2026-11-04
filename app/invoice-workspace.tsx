"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  COMPANY_IDENTITY,
  calculateTotals,
  createDefaultInvoice,
  formatCurrency,
  getPaymentEntries,
  itemAmounts,
  newId,
  normalizeInvoiceTerms,
  type InvoiceData,
  type InvoiceItem,
  type PaymentEntry,
  type SavedClient,
  type SavedInvoice,
} from "@/lib/invoice";
import {
  deleteCloudInvoice,
  migrateLocalWorkspace,
  reserveNextInvoiceNumber,
  saveCloudClient,
  saveCloudCurrent,
  saveCloudInvoice,
  watchCloudWorkspace,
} from "@/lib/firebase-workspace";
import {
  hasMigratedLocalData,
  loadLegacyLocalWorkspace,
  markLegacyLocalDataMigrated,
} from "@/lib/invoice-storage";
import { firebaseConfigured } from "@/lib/firebase";

type Area = "client" | "details" | "payment";
const FIRESTORE_UNAVAILABLE_MESSAGE = "Unable to connect to Firestore. Check Firebase configuration, network access, and Firestore rules, then retry. Invoice data is not being saved in this browser.";

const iconPaths: Record<string, ReactNode> = {
  add: <><path d="M12 5v14M5 12h14" /></>,
  arrowDown: <><path d="M12 5v14M19 12l-7 7-7-7" /></>,
  arrowUp: <><path d="M12 19V5M5 12l7-7 7 7" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  close: <><path d="m18 6-12 12M6 6l12 12" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h8" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  printer: <><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v8H6z" /></>,
  save: <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" /><path d="M17 21v-8H7v8M7 3v5h8" /></>,
  trash: <><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6" /><path d="M10 11v5m4-5v5" /></>,
};

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {iconPaths[name] ?? iconPaths.file}
    </svg>
  );
}

function Field({ label, children, hint, className = "" }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="editor-section" open={defaultOpen}>
      <summary>
        <strong>{title}</strong>
        <Icon name="chevron" size={17} />
      </summary>
      <div className="section-content">{children}</div>
    </details>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input-control ${props.className ?? ""}`} />;
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`input-control textarea-control ${props.className ?? ""}`} />;
}

function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`input-control select-control ${props.className ?? ""}`} />;
}

function CompanyLogo({ className }: { className: string }) {
  return (
    <Image src="/techgajana-mark.png" alt="Tech Gajana logo" width={470} height={370} className={className} priority unoptimized />
  );
}

export default function InvoiceWorkspace() {
  const [invoice, setInvoice] = useState<InvoiceData>(() => createDefaultInvoice("TG-INV-2026-001", "2026-01-01"));
  const [history, setHistory] = useState<SavedInvoice[]>([]);
  const [clients, setClients] = useState<SavedClient[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState("");
  const [cloudAvailable, setCloudAvailable] = useState(false);
  const [recordId, setRecordId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: "success" | "error" } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const totals = useMemo(() => calculateTotals(invoice), [invoice]);
  const paymentEntries = useMemo(() => getPaymentEntries(invoice.payment), [invoice.payment]);
  const invoiceTerms = useMemo(() => normalizeInvoiceTerms(invoice.terms), [invoice.terms]);

  const notify = useCallback((message: string, kind: "success" | "error" = "success") => {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 3400);
  }, []);

  useEffect(() => {
    let active = true;
    let stopWorkspace = () => {};
    const loadWorkspace = async () => {
      try {
        const shouldMigrateLocalData = !hasMigratedLocalData();
        const legacyWorkspace = shouldMigrateLocalData
          ? loadLegacyLocalWorkspace()
          : { current: null, history: [], clients: [] };
        const cloudWorkspace = await migrateLocalWorkspace({
          current: legacyWorkspace.current,
          history: legacyWorkspace.history,
          clients: legacyWorkspace.clients,
        });
        if (!active) return;
        if (shouldMigrateLocalData) markLegacyLocalDataMigrated();
        setCloudAvailable(true);
        setWorkspaceError("");
        const defaultNumber = cloudWorkspace.current
          ? cloudWorkspace.current.details.number
          : await reserveNextInvoiceNumber([
            ...cloudWorkspace.history.map((saved) => saved.data.details.number),
          ]);
        if (!active) return;
        setInvoice(cloudWorkspace.current ?? createDefaultInvoice(defaultNumber, new Date().toISOString().slice(0, 10)));
        setHistory(cloudWorkspace.history);
        setClients(cloudWorkspace.clients);
        setHydrated(true);
        stopWorkspace = watchCloudWorkspace((workspace) => {
          if (!active) return;
          if (workspace.current) setInvoice(workspace.current);
          setHistory(workspace.history);
          setClients(workspace.clients);
        }, (error) => {
          console.error("Unable to sync the shared invoice workspace.", error);
          if (active) {
            setCloudAvailable(false);
            setWorkspaceError(FIRESTORE_UNAVAILABLE_MESSAGE);
          }
        });
      } catch (error) {
        console.error("Unable to load the shared invoice workspace.", error);
        if (active) {
          setCloudAvailable(false);
          setWorkspaceError(error instanceof Error ? error.message : FIRESTORE_UNAVAILABLE_MESSAGE);
        }
      } finally {
        if (active) setWorkspaceLoading(false);
      }
    };
    void loadWorkspace();
    return () => {
      active = false;
      stopWorkspace();
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !cloudAvailable) return;
    const timer = window.setTimeout(() => {
      void saveCloudCurrent(invoice).catch((error: unknown) => {
        console.error("Unable to sync the current invoice.", error);
        setCloudAvailable(false);
        setWorkspaceError(FIRESTORE_UNAVAILABLE_MESSAGE);
        notify("The current invoice could not be saved to Firestore.", "error");
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [invoice, hydrated, cloudAvailable, notify]);

  const updateArea = <K extends Area>(area: K, changes: Partial<InvoiceData[K]>) => {
    setInvoice((current) => ({
      ...current,
      [area]: { ...current[area], ...changes },
    }));
  };

  const updateItem = (id: string, changes: Partial<InvoiceItem>) => {
    setInvoice((current) => ({
      ...current,
      items: current.items.map((item) => item.id === id ? { ...item, ...changes } : item),
    }));
  };

  const updatePayment = (id: string, changes: Partial<PaymentEntry>) => {
    setInvoice((current) => {
      const payments = getPaymentEntries(current.payment).map((payment) => (
        payment.id === id ? { ...payment, ...changes } : payment
      ));
      return {
        ...current,
        payment: {
          ...current.payment,
          payments,
          advance: payments[0]?.amount ?? 0,
          date: payments[0]?.date ?? "",
        },
      };
    });
  };

  const addPayment = () => {
    setInvoice((current) => {
      const payments = getPaymentEntries(current.payment);
      return {
        ...current,
        payment: {
          ...current.payment,
          payments: [...payments, {
            id: newId(),
            label: `Payment ${payments.length + 1}`,
            amount: 0,
            date: "",
          }],
        },
      };
    });
  };

  const removePayment = (id: string) => {
    setInvoice((current) => {
      const payments = getPaymentEntries(current.payment).filter((payment) => payment.id !== id);
      return {
        ...current,
        payment: {
          ...current.payment,
          payments,
          advance: payments[0]?.amount ?? 0,
          date: payments[0]?.date ?? "",
        },
      };
    });
  };

  const validate = (forPrint = false): string | null => {
    if (!invoice.details.number.trim()) return "Enter an invoice number.";
    if (invoice.items.length === 0) return "Add at least one service or item.";
    if (forPrint && !invoice.client.name.trim()) return "Add the client or company name before printing.";
    const payments = getPaymentEntries(invoice.payment);
    if (payments.some((payment) => payment.amount < 0)) return "Payment amounts cannot be negative.";
    if (payments.some((payment) => payment.amount > 0 && !payment.date)) return "Enter a date for each recorded payment.";
    for (const item of invoice.items) {
      if (item.quantity < 0 || item.rate < 0 || item.discount < 0 || item.taxPercent < 0) {
        return "Quantities, rates, discounts, and tax rates cannot be negative.";
      }
      if (forPrint && !item.description.trim()) return "Add a description to every invoice item.";
    }
    if (invoice.additionalCharges < 0) {
      return "Additional charges cannot be negative.";
    }
    return null;
  };

  const saveDraft = async () => {
    const validationError = validate();
    if (validationError) {
      notify(validationError, "error");
      return;
    }
    const duplicate = history.find((entry) => entry.data.details.number.trim().toLowerCase() === invoice.details.number.trim().toLowerCase() && entry.id !== recordId);
    if (duplicate) {
      notify("That invoice number is already saved. Use a unique number to avoid duplicates.", "error");
      return;
    }
    if (!cloudAvailable) {
      notify(FIRESTORE_UNAVAILABLE_MESSAGE, "error");
      return;
    }
    const id = recordId ?? newId();
    const savedInvoice: SavedInvoice = { id, savedAt: new Date().toISOString(), data: invoice };
    try {
      await saveCloudInvoice(savedInvoice);
    } catch (error) {
      console.error("Unable to save invoice draft to Firestore.", error);
      setCloudAvailable(false);
      setWorkspaceError(FIRESTORE_UNAVAILABLE_MESSAGE);
      notify("Invoice draft could not be saved to Firestore.", "error");
      return;
    }
    setHistory((current) => [savedInvoice, ...current.filter((entry) => entry.id !== id)]);
    setRecordId(id);
    notify("Invoice draft saved to Firestore.");
  };

  const startNewInvoice = async () => {
    if (!window.confirm("Start a new invoice? Unsaved client, item, and payment edits will be replaced.")) return;
    try {
      const number = await reserveNextInvoiceNumber([
        invoice.details.number,
        ...history.map((saved) => saved.data.details.number),
      ]);
      const fresh = createDefaultInvoice(number, new Date().toISOString().slice(0, 10));
      fresh.terms = [...invoice.terms];
      setInvoice(fresh);
      setRecordId(null);
      setShowHistory(false);
    } catch (error) {
      console.error("Unable to reserve a new invoice number from Firestore.", error);
      notify("A new invoice number could not be reserved. Check your Firestore connection.", "error");
    }
  };

  const duplicateInvoice = async () => {
    try {
      const number = await reserveNextInvoiceNumber([
        invoice.details.number,
        ...history.map((saved) => saved.data.details.number),
      ]);
      const copy = structuredClone(invoice);
      copy.details.number = number;
      copy.details.date = new Date().toISOString().slice(0, 10);
      setInvoice(copy);
      setRecordId(null);
      setShowHistory(false);
      notify("Invoice duplicated with a new invoice number.");
    } catch (error) {
      console.error("Unable to reserve an invoice number for duplication.", error);
      notify("Invoice could not be duplicated because a new number was not reserved.", "error");
    }
  };

  const loadSavedInvoice = (entry: SavedInvoice) => {
    setInvoice(entry.data);
    setRecordId(entry.id);
    setShowHistory(false);
    notify(`Loaded ${entry.data.details.number}.`);
  };

  const deleteSavedInvoice = async (entry: SavedInvoice) => {
    if (!window.confirm(`Delete saved invoice ${entry.data.details.number}? This cannot be undone.`)) return;
    if (!cloudAvailable) {
      notify(FIRESTORE_UNAVAILABLE_MESSAGE, "error");
      return;
    }
    try {
      await deleteCloudInvoice(entry.id);
    } catch (error) {
      console.error("Unable to delete invoice from Firestore.", error);
      setCloudAvailable(false);
      setWorkspaceError(FIRESTORE_UNAVAILABLE_MESSAGE);
      notify("Saved invoice could not be deleted from Firestore.", "error");
      return;
    }
    setHistory((current) => current.filter((saved) => saved.id !== entry.id));
    if (recordId === entry.id) setRecordId(null);
    notify("Saved invoice deleted from Firestore.");
  };

  const saveClient = async () => {
    if (!invoice.client.name.trim()) {
      notify("Enter a client name before saving client details.", "error");
      return;
    }
    const name = invoice.client.name.trim();
    const existing = clients.find((saved) => saved.name.toLowerCase() === name.toLowerCase());
    const client: SavedClient = {
      id: existing?.id ?? newId(),
      name,
      details: { ...invoice.client },
    };
    if (!cloudAvailable) {
      notify(FIRESTORE_UNAVAILABLE_MESSAGE, "error");
      return;
    }
    try {
      await saveCloudClient(client);
    } catch (error) {
      console.error("Unable to save client details to Firestore.", error);
      setCloudAvailable(false);
      setWorkspaceError(FIRESTORE_UNAVAILABLE_MESSAGE);
      notify("Client details could not be saved to Firestore.", "error");
      return;
    }
    setClients((current) => [client, ...current.filter((saved) => saved.id !== client.id && saved.name.toLowerCase() !== client.name.toLowerCase())]);
    notify("Client details saved to Firestore.");
  };

  const downloadInvoicePdf = async () => {
    const validationError = validate(true);
    if (validationError) {
      notify(validationError, "error");
      return;
    }
    const duplicate = history.find((entry) => (
      entry.data.details.number.trim().toLowerCase() === invoice.details.number.trim().toLowerCase()
      && entry.id !== recordId
    ));
    if (duplicate) {
      notify("That invoice number is already saved. Use a unique number to avoid duplicates.", "error");
      return;
    }
    if (!cloudAvailable) {
      notify(FIRESTORE_UNAVAILABLE_MESSAGE, "error");
      return;
    }

    const safePart = (value: string) => value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim().replace(/\s+/g, "_");
    const id = recordId ?? newId();
    const savedInvoice: SavedInvoice = { id, savedAt: new Date().toISOString(), data: invoice };
    setIsGeneratingPdf(true);
    try {
      await saveCloudInvoice(savedInvoice);
      setHistory((current) => [savedInvoice, ...current.filter((entry) => entry.id !== id)]);
      setRecordId(id);
    } catch (error) {
      console.error("Unable to save invoice to Firestore before PDF download.", error);
      setCloudAvailable(false);
      setWorkspaceError(FIRESTORE_UNAVAILABLE_MESSAGE);
      notify("Invoice could not be saved to Firestore, so the PDF was not downloaded.", "error");
      setIsGeneratingPdf(false);
      return;
    }

    try {
      const preview = window.document.querySelector<HTMLElement>(".invoice-document");
      if (!preview) {
        throw new Error("The invoice preview is not available.");
      }

      const { downloadInvoicePdf } = await import("@/lib/download-invoice-pdf");
      await downloadInvoicePdf(
        preview,
        `TechGajana_Invoice_${safePart(invoice.details.number)}_${safePart(invoice.client.name)}.pdf`,
      );
      notify("Invoice saved to Firestore and PDF downloaded.");
    } catch (error) {
      console.error("Unable to generate invoice PDF.", error);
      const message = error instanceof Error ? error.message : "Please try again.";
      notify(`Invoice was saved to Firestore, but PDF download failed. ${message}`, "error");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const addItem = () => {
    setInvoice((current) => ({
      ...current,
      items: [...current.items, {
        id: newId(),
        description: "",
        project: "",
        quantity: 1,
        unit: "Service",
        rate: 0,
        discountType: "percent",
        discount: 0,
        taxPercent: 0,
        taxType: "IGST",
      }],
    }));
  };

  if (workspaceLoading) {
    return <main className="auth-page"><section className="auth-panel"><h1>Loading shared workspace…</h1></section></main>;
  }

  if (!hydrated) {
    return (
      <main className="auth-page">
        <section className="auth-panel">
          <h1>Firestore is required</h1>
          <p>{firebaseConfigured ? workspaceError || FIRESTORE_UNAVAILABLE_MESSAGE : "Firebase is not configured. Add the Firestore Firebase settings before using the invoice workspace."}</p>
          <button className="button button-primary" onClick={() => window.location.reload()}>Retry connection</button>
        </section>
      </main>
    );
  }

  return (
    <main className="workspace">
      <header className="topbar">
        <a className="brand-lockup" href="#" aria-label="TechGajana invoice home">
          <CompanyLogo className="brand-logo-crop" />
          <span className="brand-name">Invoice Studio</span>
        </a>
        <div className="topbar-spacer" />
        <div
          className="local-badge"
          aria-label={cloudAvailable
            ? "Public shared workspace. Anyone with the app URL can view, edit, or delete workspace invoices and client details."
            : workspaceError || FIRESTORE_UNAVAILABLE_MESSAGE}
          title={cloudAvailable
            ? "Anyone with the app URL can view, edit, or delete workspace invoices and client details."
            : workspaceError || FIRESTORE_UNAVAILABLE_MESSAGE}
          role="status"
        >
          <span /> {cloudAvailable ? "Firestore shared workspace" : "Firestore unavailable · saving disabled"}
        </div>
      </header>

      <section className="page-heading">
        <h1>Create invoice</h1>
        <div className="heading-meta">
          <span className="meta-label">INVOICE NUMBER</span>
          <span className="meta-number">{invoice.details.number || "—"}</span>
        </div>
      </section>

      <div className="toolbar">
        <div className="toolbar-left">
          <button className="button button-outline" onClick={startNewInvoice}><Icon name="add" /> New invoice</button>
          <button className="button button-outline" onClick={saveDraft}><Icon name="save" /> Save draft</button>
          <button className="button button-outline duplicate-action" onClick={duplicateInvoice}><Icon name="copy" /> Duplicate</button>
          <button className={`button button-outline ${showHistory ? "is-selected" : ""}`} onClick={() => setShowHistory((visible) => !visible)}>
            <Icon name="history" /> History{history.length > 0 && <span className="count-pill">{history.length}</span>}
          </button>
        </div>
        <div className="toolbar-right">
          <button className="button button-primary" onClick={downloadInvoicePdf} disabled={isGeneratingPdf}>
            <Icon name="download" /> {isGeneratingPdf ? "Generating PDF…" : "Download PDF"}
          </button>
        </div>
      </div>

      {showHistory && (
        <aside className="history-panel">
          <div className="history-heading">
            <div><strong>Saved invoices</strong><span>Shared with your workspace.</span></div>
            <button type="button" className="icon-button" onClick={() => setShowHistory(false)} aria-label="Close invoice history"><Icon name="close" /></button>
          </div>
          {history.length === 0 ? (
            <div className="history-empty"><span className="empty-file"><Icon name="file" size={21} /></span><strong>No saved invoices yet</strong><span>Save a draft to find it here.</span></div>
          ) : history.map((entry) => (
            <div className="history-row" key={entry.id}>
              <button type="button" className="history-load" onClick={() => loadSavedInvoice(entry)}>
                <span className="history-invoice-number">{entry.data.details.number}</span>
                <span className="history-invoice-client">{entry.data.client.name || "Untitled client"} · {new Date(entry.savedAt).toLocaleDateString("en-IN")}</span>
              </button>
              <button type="button" className="icon-button danger-hover" onClick={() => deleteSavedInvoice(entry)} aria-label={`Delete ${entry.data.details.number}`}><Icon name="trash" size={15} /></button>
            </div>
          ))}
        </aside>
      )}

      <section className="workspace-grid">
        <div className="editor-column">
          <div className="column-heading">
            <h2>Invoice details</h2>
          </div>

          <Section title="Client details" defaultOpen>
            <div className="section-grid">
              <Field label="Client name" className="span-2">
                <TextInput value={invoice.client.name} onChange={(event) => updateArea("client", { name: event.target.value })} placeholder="Client name" />
              </Field>
              {clients.length > 0 && (
                <Field label="Saved client" className="span-2">
                  <SelectInput value="" onChange={(event) => {
                    const selected = clients.find((client) => client.id === event.target.value);
                    if (selected) updateArea("client", selected.details);
                  }}>
                    <option value="">Choose a saved client…</option>
                    {clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}
                  </SelectInput>
                </Field>
              )}
              <Field label="Billing address" className="span-2">
                <TextArea rows={2} value={invoice.client.address} onChange={(event) => updateArea("client", { address: event.target.value })} placeholder="Street, city, state, PIN code" />
              </Field>
              <Field label="GSTIN (optional)">
                <TextInput value={invoice.client.gstin} onChange={(event) => updateArea("client", { gstin: event.target.value })} placeholder="Client GSTIN" />
              </Field>
            </div>
            <button type="button" className="text-button save-client-action" onClick={saveClient}><Icon name="save" size={14} /> Save client for later</button>
          </Section>

          <Section title="Invoice information" defaultOpen>
            <div className="section-grid">
              <Field label="Invoice number">
                <TextInput value={invoice.details.number} onChange={(event) => updateArea("details", { number: event.target.value })} />
              </Field>
              <Field label="Invoice date">
                <TextInput type="date" value={invoice.details.date} onChange={(event) => updateArea("details", { date: event.target.value })} />
              </Field>
            </div>
          </Section>

          <Section title={`Services & items (${invoice.items.length})`} defaultOpen>
            <div className="items-editor">
              {invoice.items.map((item, index) => {
                const amounts = itemAmounts(item, invoice.gstEnabled !== false);
                return (
                  <article className="item-card" key={item.id}>
                    <div className="item-card-top">
                      <span className="item-card-index">ITEM {String(index + 1).padStart(2, "0")}</span>
                      <button type="button" className="icon-button danger-hover" aria-label={`Remove item ${index + 1}`} onClick={() => setInvoice((current) => ({ ...current, items: current.items.filter((row) => row.id !== item.id) }))}><Icon name="trash" size={15} /></button>
                    </div>
                    <Field label="Service description">
                      <TextInput value={item.description} onChange={(event) => updateItem(item.id, { description: event.target.value })} placeholder="e.g. Custom Software Development" list={`services-${item.id}`} />
                      <datalist id={`services-${item.id}`}>
                        {["Website Development", "Custom Software Development", "Mobile Application Development", "UI/UX Design", "Software Maintenance", "Digital Marketing Services", "Domain and Hosting", "Business Email Setup"].map((service) => <option key={service} value={service} />)}
                      </datalist>
                    </Field>
                    <div className="section-grid item-grid">
                      <Field label="Project name">
                        <TextInput value={item.project} onChange={(event) => updateItem(item.id, { project: event.target.value })} placeholder="Optional" />
                      </Field>
                      <Field label="Quantity">
                        <TextInput type="number" min="0" step="0.01" value={item.quantity} onChange={(event) => updateItem(item.id, { quantity: Number(event.target.value) })} />
                      </Field>
                      <Field label="Unit">
                        <TextInput value={item.unit} onChange={(event) => updateItem(item.id, { unit: event.target.value })} placeholder="Hours, project…" />
                      </Field>
                      <Field label="Rate">
                        <TextInput type="number" min="0" step="0.01" value={item.rate} onChange={(event) => updateItem(item.id, { rate: Number(event.target.value) })} />
                      </Field>
                      <Field label="Discount">
                        <div className="input-combo">
                          <TextInput type="number" min="0" step="0.01" value={item.discount} onChange={(event) => updateItem(item.id, { discount: Number(event.target.value) })} />
                          <SelectInput value={item.discountType} aria-label="Discount type" onChange={(event) => updateItem(item.id, { discountType: event.target.value as InvoiceItem["discountType"] })}>
                            <option value="percent">%</option><option value="amount">₹</option>
                          </SelectInput>
                        </div>
                      </Field>
                      {invoice.gstEnabled !== false && (
                        <>
                          <Field label="GST rate">
                            <div className="input-combo tax-combo">
                              <TextInput type="number" min="0" step="0.01" value={item.taxPercent} onChange={(event) => updateItem(item.id, { taxPercent: Number(event.target.value) })} />
                              <span>%</span>
                            </div>
                          </Field>
                          <Field label="GST type">
                            <SelectInput value={item.taxType} onChange={(event) => updateItem(item.id, { taxType: event.target.value as InvoiceItem["taxType"] })}>
                              <option>IGST</option><option>CGST + SGST</option>
                            </SelectInput>
                          </Field>
                        </>
                      )}
                    </div>
                    <div className="item-calculation"><span>Line total <b>{formatCurrency(amounts.lineTotal, invoice.details.currency)}</b></span><span>Discount <b>− {formatCurrency(amounts.discount, invoice.details.currency)}</b></span><span className="item-taxable">Taxable <b>{formatCurrency(amounts.taxable, invoice.details.currency)}</b></span></div>
                  </article>
                );
              })}
              <button type="button" className="add-item-button" onClick={addItem}><span><Icon name="add" /></span> Add a line item</button>
            </div>
          </Section>

          <Section title="Tax & adjustments">
            <div className="section-grid">
              <label className="toggle-field gst-toggle-field span-2">
                <span><strong>GST</strong><small>Include GST in this invoice</small></span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="Apply GST to invoice"
                  checked={invoice.gstEnabled !== false}
                  onChange={(event) => setInvoice((current) => ({ ...current, gstEnabled: event.target.checked }))}
                />
              </label>
              <Field label="Additional charges" hint="Shipping, handling, or other charges">
                <TextInput type="number" min="0" step="0.01" value={invoice.additionalCharges} onChange={(event) => setInvoice((current) => ({ ...current, additionalCharges: Number(event.target.value) }))} />
              </Field>
              <Field label="Round off" hint="Use a negative amount to round down">
                <TextInput type="number" step="0.01" value={invoice.roundOff} onChange={(event) => setInvoice((current) => ({ ...current, roundOff: Number(event.target.value) }))} />
              </Field>
              <div className="calculation-note span-2"><span className="calc-note-icon">↗</span><span>{invoice.gstEnabled !== false ? "GST is calculated on each item after its discount. IGST or an equal CGST + SGST split is applied per line." : "GST is off for this invoice. Saved GST rates are kept in case you turn it back on."}</span></div>
            </div>
          </Section>

          <Section title="Project payments">
            <div className="payment-entries">
              {paymentEntries.map((payment, index) => (
                <div className="payment-entry" key={payment.id}>
                  <div className="payment-entry-heading">
                    {index === 0 ? (
                      <strong>Payment 1 · Advance</strong>
                    ) : (
                      <Field label={`Payment ${index + 1} milestone`}>
                        <TextInput
                          value={payment.label}
                          onChange={(event) => updatePayment(payment.id, { label: event.target.value })}
                          placeholder="e.g. Design approval"
                        />
                      </Field>
                    )}
                    {index > 0 && (
                      <button
                        type="button"
                        className="icon-button danger-hover"
                        aria-label={`Remove payment ${index + 1}`}
                        onClick={() => removePayment(payment.id)}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </div>
                  <div className="section-grid payment-entry-fields">
                    <Field label="Amount paid">
                      <TextInput
                        type="number"
                        min="0"
                        step="0.01"
                        value={payment.amount}
                        onChange={(event) => updatePayment(payment.id, { amount: Number(event.target.value) })}
                      />
                    </Field>
                    <Field label="Payment date">
                      <TextInput
                        type="date"
                        value={payment.date}
                        onChange={(event) => updatePayment(payment.id, { date: event.target.value })}
                      />
                    </Field>
                  </div>
                </div>
              ))}
              <button type="button" className="text-button add-payment-action" onClick={addPayment}>
                <Icon name="add" size={14} /> Add project payment
              </button>
            </div>
            <div className="payment-status-row">
              <span>Payment status</span><span className={`status-pill status-${totals.status.toLowerCase().replace(" ", "-")}`}><span />{totals.status}</span>
            </div>
          </Section>

          <Section title={`Terms & conditions (${invoiceTerms.length})`}>
            <div className="terms-editor">
              {invoiceTerms.map((term, index) => (
                <div className="term-row" key={`${index}-${term.slice(0, 15)}`}>
                  <span className="term-number">{String(index + 1).padStart(2, "0")}</span>
                  <TextInput aria-label={`Term ${index + 1}`} value={term} onChange={(event) => setInvoice((current) => ({ ...current, terms: current.terms.map((value, row) => row === index ? event.target.value : value) }))} />
                  <button type="button" className="icon-button" aria-label={`Move term ${index + 1} up`} disabled={index === 0} onClick={() => setInvoice((current) => ({ ...current, terms: moveItem(current.terms, index, index - 1) }))}><Icon name="arrowUp" size={14} /></button>
                  <button type="button" className="icon-button" aria-label={`Move term ${index + 1} down`} disabled={index === invoice.terms.length - 1} onClick={() => setInvoice((current) => ({ ...current, terms: moveItem(current.terms, index, index + 1) }))}><Icon name="arrowDown" size={14} /></button>
                  <button type="button" className="icon-button danger-hover" aria-label={`Remove term ${index + 1}`} onClick={() => setInvoice((current) => ({ ...current, terms: current.terms.filter((_, row) => row !== index) }))}><Icon name="trash" size={14} /></button>
                </div>
              ))}
              <button type="button" className="text-button" onClick={() => setInvoice((current) => ({ ...current, terms: [...current.terms, ""] }))}><Icon name="add" size={14} /> Add a term</button>
            </div>
          </Section>

          <div className="editor-footer-note"><span className="privacy-lock">⌑</span> Company address, CIN, signature, and seal are configured in the code.</div>
        </div>

        <div className="preview-column">
          <div className="preview-header">
            <h2>Preview</h2>
            <span className="preview-page-label">Updates as you type</span>
          </div>
          <div className="preview-frame">
            <InvoicePreview invoice={invoice} totals={totals} />
          </div>
          <div className="preview-help"><span className="preview-help-icon">i</span><span>Changes appear instantly. <strong>Download PDF</strong> saves a print-ready A4 invoice to your device.</span></div>
        </div>
      </section>

      {toast && <div role="status" className={`toast toast-${toast.kind}`}><span className="toast-icon"><Icon name={toast.kind === "success" ? "check" : "close"} size={15} /></span>{toast.message}</div>}
    </main>
  );
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const copy = [...items];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

function InvoicePreview({
  invoice,
  totals,
}: {
  invoice: InvoiceData;
  totals: ReturnType<typeof calculateTotals>;
}) {
  const shownDate = (value: string) => value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
  const fmt = (value: number) => formatCurrency(value, invoice.details.currency);
  const gstEnabled = invoice.gstEnabled !== false;
  const invoiceTerms = normalizeInvoiceTerms(invoice.terms);
  const paymentEntries = getPaymentEntries(invoice.payment);
  const recordedPayments = paymentEntries
    .map((payment, index) => ({ payment, index }))
    .filter(({ payment }) => payment.amount > 0);
  const amountPaid = recordedPayments.reduce((sum, { payment }) => sum + payment.amount, 0);
  const itemAmountTotals = invoice.items.reduce((summary, item) => {
    const amounts = itemAmounts(item, gstEnabled);
    if (item.taxType === "IGST") summary.igst += amounts.tax;
    else {
      summary.cgst += amounts.tax / 2;
      summary.sgst += amounts.tax / 2;
    }
    return summary;
  }, { igst: 0, cgst: 0, sgst: 0 });

  return (
    <div className="invoice-document">
    <article className="invoice-paper" data-pdf-page-index="0">
      <div className="paper-top-accent" />
      <header className="paper-header">
        <div className="paper-company">
          <CompanyLogo className="paper-logo-crop" />
          <div className="paper-company-info">
            <strong>{COMPANY_IDENTITY.name}</strong>
            {COMPANY_IDENTITY.address && <span>{COMPANY_IDENTITY.address}</span>}
            {COMPANY_IDENTITY.cin && <span>CIN: {COMPANY_IDENTITY.cin}</span>}
            {COMPANY_IDENTITY.contact && <span>Contact: {COMPANY_IDENTITY.contact}</span>}
          </div>
        </div>
        <div className="paper-title-block">
          <h2>{invoice.details.type === "Tax Invoice" ? "INVOICE" : invoice.details.type.toUpperCase()}</h2>
          <span className="paper-invoice-number">#{invoice.details.number || "—"}</span>
        </div>
      </header>

      <div className="paper-rule" />
      <section className="paper-meta-grid">
        <div className="paper-meta-item"><span>INVOICE DATE</span><strong>{shownDate(invoice.details.date)}</strong></div>
        <div className="paper-meta-item"><span>PAYMENT STATUS</span><strong className={`paper-status paper-${totals.status.toLowerCase().replace(" ", "-")}`}>{totals.status}</strong></div>
      </section>

      <section className="paper-billto">
        <div className="paper-section-label"><span className="paper-section-marker" /> BILL TO</div>
        <div className="paper-billto-details">
          <strong className="paper-client-name">{invoice.client.name || "Client name"}</strong>
          {invoice.client.address && <span>{invoice.client.address}</span>}
          {invoice.client.contact && <span>Attn: {invoice.client.contact}</span>}
          {invoice.client.phone && <span>Phone: {invoice.client.phone}</span>}
          {invoice.client.email && <span>Email: {invoice.client.email}</span>}
          {invoice.client.gstin && <span>GSTIN: {invoice.client.gstin}</span>}
          {(invoice.client.placeOfSupply || invoice.details.placeOfSupply) && (
            <span>Place of supply: {invoice.client.placeOfSupply || invoice.details.placeOfSupply}</span>
          )}
        </div>
      </section>

      <div className="paper-table-wrap">
        <table className="paper-items-table">
          <thead><tr><th className="col-number">#</th><th className="col-description">DESCRIPTION</th><th className="col-qty">QTY</th><th className="col-rate">RATE</th>{gstEnabled && <th className="col-tax">GST</th>}<th className="col-amount">AMOUNT</th></tr></thead>
          <tbody>
            {invoice.items.map((item, index) => {
              const amounts = itemAmounts(item, gstEnabled);
              return (
                <tr key={item.id}>
                  <td className="col-number">{String(index + 1).padStart(2, "0")}</td>
                  <td className="col-description"><strong>{item.description || "Service description"}</strong>{item.project && <small>{item.project}</small>}</td>
                  <td className="col-qty">{item.quantity} <span>{item.unit}</span></td>
                  <td className="col-rate">{fmt(item.rate)}</td>
                  {gstEnabled && <td className="col-tax">{item.taxPercent > 0 ? `${item.taxPercent}%` : "—"}</td>}
                  <td className="col-amount"><strong>{fmt(amounts.total)}</strong></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="paper-bottom-grid">
        <div className="paper-payment">
          <div className="paper-section-label"><span className="paper-section-marker" /> PAYMENT SUMMARY</div>
          <div className="paper-payment-content">
            {recordedPayments.length > 0 ? (
              <div className="paper-payment-list">
                {recordedPayments.map(({ payment, index }) => (
                  <div className="paper-payment-row" key={payment.id}>
                    <span>{index === 0 ? "Advance" : payment.label || `Payment ${index + 1}`}</span>
                    <strong>{fmt(payment.amount)}</strong>
                    <small>{shownDate(payment.date)}</small>
                  </div>
                ))}
              </div>
            ) : (
              <div className="paper-advance-note">No payments recorded.</div>
            )}
            {amountPaid > 0 && <div className="paper-total-row paper-advance-total"><span>Total received</span><strong>{fmt(amountPaid)}</strong></div>}
            <div className="paper-balance"><span>Remaining balance</span><strong>{fmt(totals.balanceDue)}</strong></div>
          </div>
        </div>
        <div className="paper-totals">
          <div className="paper-total-row"><span>Line total</span><strong>{fmt(totals.lineTotal)}</strong></div>
          {totals.discount > 0 && <div className="paper-total-row"><span>Discount</span><strong>− {fmt(totals.discount)}</strong></div>}
          <div className="paper-total-row"><span>Subtotal</span><strong>{fmt(totals.taxable)}</strong></div>
          {gstEnabled && itemAmountTotals.igst > 0 && <div className="paper-total-row"><span>IGST</span><strong>{fmt(itemAmountTotals.igst)}</strong></div>}
          {gstEnabled && itemAmountTotals.cgst > 0 && <div className="paper-total-row"><span>CGST</span><strong>{fmt(itemAmountTotals.cgst)}</strong></div>}
          {gstEnabled && itemAmountTotals.sgst > 0 && <div className="paper-total-row"><span>SGST</span><strong>{fmt(itemAmountTotals.sgst)}</strong></div>}
          {invoice.additionalCharges > 0 && <div className="paper-total-row"><span>Additional charges</span><strong>{fmt(invoice.additionalCharges)}</strong></div>}
          {invoice.roundOff !== 0 && <div className="paper-total-row"><span>Round off</span><strong>{invoice.roundOff < 0 ? "− " : ""}{fmt(Math.abs(invoice.roundOff))}</strong></div>}
          <div className="paper-grand-total"><span>INVOICE TOTAL</span><strong>{fmt(totals.grandTotal)}</strong></div>
        </div>
      </div>

      {invoice.terms.length > 0 && (
        <section className="paper-terms">
          <div className="paper-section-label"><span className="paper-section-marker" /> TERMS & CONDITIONS</div>
          <ol>{invoiceTerms.filter((term) => term.trim()).map((term, index) => <li key={`${index}-${term}`}>{term}</li>)}</ol>
        </section>
      )}

      <footer className="paper-footer">
        <div className="paper-signature-block">
          <div className="paper-sign-images">
            {COMPANY_IDENTITY.signatureSrc && <Image src={COMPANY_IDENTITY.signatureSrc} alt="Authorized signature" width={180} height={123} className="paper-signature-image" unoptimized />}
            {COMPANY_IDENTITY.sealSrc && <Image src={COMPANY_IDENTITY.sealSrc} alt="Company seal" width={70} height={70} />}
          </div>
          <strong>Authorized signatory</strong>
          <span>For {COMPANY_IDENTITY.name}</span>
        </div>
        <div className="paper-thank-you"><span>THANK YOU FOR YOUR BUSINESS</span><strong>We appreciate the opportunity to work with you.</strong></div>
      </footer>
    </article>
    </div>
  );
}
