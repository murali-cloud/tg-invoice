"use client";

import Image from "next/image";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import {
  calculateTotals,
  createDefaultInvoice,
  formatCurrency,
  itemAmounts,
  newId,
  type BankDetails,
  type CompanyDetails,
  type InvoiceData,
  type InvoiceItem,
  type SavedClient,
  type SavedInvoice,
  type StoredAsset,
} from "@/lib/invoice";
import { firebaseAuth, firebaseConfigured } from "@/lib/firebase";
import {
  deleteCloudInvoice,
  loadCloudAsset,
  migrateLocalWorkspace,
  saveCloudClient,
  saveCloudCurrent,
  saveCloudInvoice,
  uploadCloudAsset,
  watchCloudWorkspace,
} from "@/lib/firebase-workspace";
import {
  advanceInvoiceSequence,
  getNextInvoiceNumber,
  hasMigratedLocalData,
  loadAsset,
  loadClients,
  loadCurrent,
  loadHistory,
  saveAsset,
  saveClients,
  saveCurrent,
  saveHistory,
  markLocalDataMigrated,
} from "@/lib/invoice-storage";

type Area = "company" | "client" | "details" | "payment" | "bank";
type AssetTarget = "logo" | "signature" | "stamp" | "qr" | "proof";

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

export default function InvoiceWorkspace() {
  const [invoice, setInvoice] = useState<InvoiceData>(() => createDefaultInvoice("TG-INV-2026-001", "2026-01-01"));
  const [history, setHistory] = useState<SavedInvoice[]>([]);
  const [clients, setClients] = useState<SavedClient[]>([]);
  const [user, setUser] = useState<{ uid: string; email: string | null } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signInError, setSignInError] = useState("");
  const [signInBusy, setSignInBusy] = useState(false);
  const [recordId, setRecordId] = useState<string | null>(null);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ message: string; kind: "success" | "error" } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const fileInputs = useRef<Record<AssetTarget, HTMLInputElement | null>>({
    logo: null,
    signature: null,
    stamp: null,
    qr: null,
    proof: null,
  });
  const objectUrls = useRef<string[]>([]);
  const totals = useMemo(() => calculateTotals(invoice), [invoice]);

  const notify = useCallback((message: string, kind: "success" | "error" = "success") => {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 3400);
  }, []);

  useEffect(() => {
    if (!firebaseAuth) return;
    let active = true;
    let stopWorkspace = () => {};
    const stopAuth = onAuthStateChanged(firebaseAuth, async (nextUser) => {
      setAuthLoading(false);
      stopWorkspace();
      setUser(nextUser ? { uid: nextUser.uid, email: nextUser.email } : null);
      setHydrated(false);
      setWorkspaceError("");
      if (!nextUser) {
        setWorkspaceLoading(false);
        return;
      }

      setWorkspaceLoading(true);
      try {
        const shouldMigrateLocalData = !hasMigratedLocalData();
        const cloudWorkspace = await migrateLocalWorkspace({
          current: shouldMigrateLocalData ? loadCurrent() : null,
          history: shouldMigrateLocalData ? loadHistory() : [],
          clients: shouldMigrateLocalData ? loadClients() : [],
        }, nextUser.uid);
        if (!active || firebaseAuth?.currentUser?.uid !== nextUser.uid) return;
        if (shouldMigrateLocalData) markLocalDataMigrated();
        cloudWorkspace.history.forEach((saved) => advanceInvoiceSequence(saved.data.details.number));
        setInvoice(cloudWorkspace.current ?? createDefaultInvoice(getNextInvoiceNumber(), new Date().toISOString().slice(0, 10)));
        setHistory(cloudWorkspace.history);
        setClients(cloudWorkspace.clients);
        setHydrated(true);
        stopWorkspace = watchCloudWorkspace(nextUser.uid, (workspace) => {
          if (!active) return;
          if (workspace.current) setInvoice(workspace.current);
          setHistory(workspace.history);
          setClients(workspace.clients);
        }, (error) => {
          console.error("Unable to sync the shared invoice workspace.", error);
          if (active) setWorkspaceError("Live updates stopped. Check your connection and Firebase permissions.");
        });
      } catch (error) {
        console.error("Unable to load the shared invoice workspace.", error);
        if (active) setWorkspaceError("Could not load the shared workspace. Confirm your account is a workspace member and try again.");
      } finally {
        if (active) setWorkspaceLoading(false);
      }
    });
    return () => {
      active = false;
      stopAuth();
      stopWorkspace();
    };
  }, [notify]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      saveCurrent(invoice);
    } catch (error) {
      console.error("Unable to save the current invoice.", error);
      window.setTimeout(() => notify("The current invoice could not be saved. Browser storage may be full.", "error"), 0);
    }
  }, [invoice, hydrated, notify]);

  useEffect(() => {
    if (!hydrated || !user) return;
    const timer = window.setTimeout(() => {
      void saveCloudCurrent(user.uid, invoice).catch((error: unknown) => {
        console.error("Unable to sync the current invoice.", error);
        notify("The current invoice could not be synced to Firebase.", "error");
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [invoice, hydrated, notify, user]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      saveHistory(history);
    } catch (error) {
      console.error("Unable to save invoice history.", error);
      window.setTimeout(() => notify("Invoice history could not be saved. Browser storage may be full.", "error"), 0);
    }
  }, [history, hydrated, notify]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      saveClients(clients);
    } catch (error) {
      console.error("Unable to save client details.", error);
      window.setTimeout(() => notify("Client details could not be saved.", "error"), 0);
    }
  }, [clients, hydrated, notify]);

  const assetRefs = useMemo(() => {
    const refs = [
      invoice.company.logo,
      invoice.company.signature,
      invoice.company.stamp,
      invoice.bank.qrCode,
      ...invoice.payment.proofs,
    ].filter((asset): asset is StoredAsset => Boolean(asset));
    return [...new Map(refs.map((ref) => [ref.id, ref])).values()];
  }, [invoice]);
  const assetKey = assetRefs.map((asset) => asset.id).join("|");

  useEffect(() => {
    if (!hydrated || assetRefs.length === 0) return;
    let active = true;
    void Promise.all(assetRefs.map(async (asset) => {
      if (assetUrls[asset.id]) return null;
      let blob: Blob | undefined;
      try {
        blob = await loadAsset(asset.id);
      } catch {
        blob = undefined;
      }
      if (!blob && user) blob = await loadCloudAsset(asset.id);
      return blob ? { id: asset.id, url: URL.createObjectURL(blob) } : null;
    })).then((loaded) => {
      if (!active) return;
      const additions: Record<string, string> = {};
      for (const asset of loaded) {
        if (asset) {
          additions[asset.id] = asset.url;
          objectUrls.current.push(asset.url);
        }
      }
      if (Object.keys(additions).length > 0) {
        setAssetUrls((current) => ({ ...current, ...additions }));
      }
    }).catch((error: unknown) => {
      console.error("Unable to load one or more uploaded invoice files.", error);
      notify("An uploaded file could not be loaded from Firebase.", "error");
    });
    return () => { active = false; };
  }, [assetKey, assetRefs, assetUrls, hydrated, notify, user]);

  useEffect(() => () => {
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
  }, []);

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

  const handleUpload = async (target: AssetTarget, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const isProof = target === "proof";
    const allowed = isProof
      ? ["image/png", "image/jpeg", "image/webp", "application/pdf"]
      : ["image/png", "image/jpeg", "image/webp"];
    if (!allowed.includes(file.type)) {
      notify(isProof ? "Choose a PNG, JPG, WebP, or PDF file." : "Choose a PNG, JPG, or WebP image.", "error");
      return;
    }

    try {
      const asset = await saveAsset(file);
      if (user) await uploadCloudAsset(asset.id, file, file.type);
      const url = URL.createObjectURL(file);
      objectUrls.current.push(url);
      setAssetUrls((current) => ({ ...current, [asset.id]: url }));
      if (target === "logo" || target === "signature" || target === "stamp") {
        updateArea("company", { [target]: asset } as Partial<CompanyDetails>);
      } else if (target === "qr") {
        updateArea("bank", { qrCode: asset } as Partial<BankDetails>);
      } else {
        setInvoice((current) => ({
          ...current,
          payment: { ...current.payment, proofs: [...current.payment.proofs, asset] },
        }));
      }
      notify(`${file.name} added to this invoice.`);
    } catch (error) {
      console.error("Unable to store uploaded file.", error);
      notify("The file could not be saved to Firebase. Check your connection and storage permissions.", "error");
    }
  };

  const removeAsset = (target: AssetTarget, assetId?: string) => {
    if (target === "logo" || target === "signature" || target === "stamp") {
      updateArea("company", { [target]: undefined } as Partial<CompanyDetails>);
    } else if (target === "qr") {
      updateArea("bank", { qrCode: undefined } as Partial<BankDetails>);
    } else {
      setInvoice((current) => ({
        ...current,
        payment: {
          ...current.payment,
          proofs: current.payment.proofs.filter((proof) => proof.id !== assetId),
        },
      }));
    }
  };

  const validate = (forPrint = false): string | null => {
    if (!invoice.details.number.trim()) return "Enter an invoice number.";
    if (invoice.items.length === 0) return "Add at least one service or item.";
    if (forPrint && !invoice.client.name.trim()) return "Add the client or company name before printing.";
    for (const item of invoice.items) {
      if (item.quantity < 0 || item.rate < 0 || item.discount < 0 || item.taxPercent < 0) {
        return "Quantities, rates, discounts, and tax rates cannot be negative.";
      }
      if (forPrint && !item.description.trim()) return "Add a description to every invoice item.";
    }
    if (invoice.payment.advance < 0 || invoice.additionalCharges < 0) {
      return "Advance payments and additional charges cannot be negative.";
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
    const id = recordId ?? newId();
    const savedInvoice: SavedInvoice = { id, savedAt: new Date().toISOString(), data: invoice };
    try {
      await saveCloudInvoice(savedInvoice);
      setHistory((current) => [savedInvoice, ...current.filter((entry) => entry.id !== id)]);
      setRecordId(id);
      advanceInvoiceSequence(invoice.details.number);
      notify("Invoice draft saved to the shared workspace.");
    } catch (error) {
      console.error("Unable to save invoice draft to Firebase.", error);
      notify("The invoice could not be saved to Firebase.", "error");
    }
  };

  const startNewInvoice = () => {
    if (!window.confirm("Start a new invoice? Unsaved client, item, and payment edits will be replaced.")) return;
    const fresh = createDefaultInvoice(getNextInvoiceNumber(), new Date().toISOString().slice(0, 10));
    fresh.company = invoice.company;
    fresh.bank = invoice.bank;
    fresh.terms = [...invoice.terms];
    setInvoice(fresh);
    setRecordId(null);
    setShowHistory(false);
  };

  const duplicateInvoice = () => {
    const copy = structuredClone(invoice);
    copy.details.number = getNextInvoiceNumber();
    copy.details.date = new Date().toISOString().slice(0, 10);
    setInvoice(copy);
    setRecordId(null);
    setShowHistory(false);
    notify("Invoice duplicated with a new invoice number.");
  };

  const loadSavedInvoice = (entry: SavedInvoice) => {
    setInvoice(entry.data);
    setRecordId(entry.id);
    setShowHistory(false);
    notify(`Loaded ${entry.data.details.number}.`);
  };

  const deleteSavedInvoice = async (entry: SavedInvoice) => {
    if (!window.confirm(`Delete saved invoice ${entry.data.details.number}? This cannot be undone.`)) return;
    try {
      await deleteCloudInvoice(entry.id);
      setHistory((current) => current.filter((saved) => saved.id !== entry.id));
      if (recordId === entry.id) setRecordId(null);
      notify("Saved invoice deleted from the shared workspace.");
    } catch (error) {
      console.error("Unable to delete invoice from Firebase.", error);
      notify("The invoice could not be deleted from Firebase.", "error");
    }
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
    try {
      await saveCloudClient(client);
      setClients((current) => [client, ...current.filter((saved) => saved.id !== client.id && saved.name.toLowerCase() !== client.name.toLowerCase())]);
      notify("Client details saved to the shared workspace.");
    } catch (error) {
      console.error("Unable to save client details to Firebase.", error);
      notify("Client details could not be saved to Firebase.", "error");
    }
  };

  const submitSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firebaseAuth) return;
    setSignInError("");
    setSignInBusy(true);
    try {
      await signInWithEmailAndPassword(firebaseAuth, signInEmail.trim(), signInPassword);
    } catch (error) {
      console.error("Unable to sign in to Firebase.", error);
      setSignInError("Sign-in failed. Check your email, password, and Firebase account setup.");
    } finally {
      setSignInBusy(false);
    }
  };

  const signOutUser = async () => {
    if (!firebaseAuth) return;
    await signOut(firebaseAuth);
  };

  const downloadInvoicePdf = async () => {
    const validationError = validate(true);
    if (validationError) {
      notify(validationError, "error");
      return;
    }

    const safePart = (value: string) => value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim().replace(/\s+/g, "_");
    setIsGeneratingPdf(true);
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
      notify("Invoice PDF downloaded.");
    } catch (error) {
      console.error("Unable to generate invoice PDF.", error);
      const message = error instanceof Error ? error.message : "Please try again.";
      notify(`PDF download failed. ${message}`, "error");
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
        code: "",
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

  const assetControl = (target: AssetTarget, asset?: StoredAsset, title = "Upload file") => (
    <div className="asset-control">
      <input
        ref={(element) => { fileInputs.current[target] = element; }}
        type="file"
        accept={target === "proof" ? "image/png,image/jpeg,image/webp,application/pdf" : "image/png,image/jpeg,image/webp"}
        onChange={(event) => void handleUpload(target, event)}
        hidden
      />
      {asset ? (
        <div className="asset-picked">
          <span className="asset-check"><Icon name="check" size={13} /></span>
          <span className="asset-name" title={asset.name}>{asset.name}</span>
          <button type="button" className="icon-button danger-hover" aria-label={`Remove ${asset.name}`} onClick={() => removeAsset(target, asset.id)}>
            <Icon name="close" size={15} />
          </button>
        </div>
      ) : (
        <button type="button" className="upload-button" onClick={() => fileInputs.current[target]?.click()}>
          <span className="upload-icon"><Icon name="add" size={16} /></span>
          <span><strong>{title}</strong><small>PNG, JPG, WebP{target === "proof" ? ", PDF" : ""}</small></span>
        </button>
      )}
    </div>
  );

  if (!firebaseConfigured) {
    return (
      <main className="auth-page">
        <section className="auth-panel">
          <div className="auth-kicker">TECHGAJANA · INVOICE STUDIO</div>
          <h1>Firebase setup required</h1>
          <p>Copy <code>.env.example</code> to <code>.env.local</code>, add the Firebase web app settings, then restart the development server.</p>
        </section>
      </main>
    );
  }

  if (authLoading) {
    return <main className="auth-page"><section className="auth-panel"><h1>Connecting to Firebase…</h1></section></main>;
  }

  if (!user) {
    return (
      <main className="auth-page">
        <section className="auth-panel">
          <div className="auth-kicker">TECHGAJANA · INVOICE STUDIO</div>
          <h1>Sign in</h1>
          <p>Use your company workspace account to access shared invoices and clients.</p>
          <form className="auth-form" onSubmit={(event) => void submitSignIn(event)}>
            <label className="auth-field">
              <span>Email</span>
              <input className="input-control" type="email" autoComplete="username" value={signInEmail} onChange={(event) => setSignInEmail(event.target.value)} required />
            </label>
            <label className="auth-field">
              <span>Password</span>
              <input className="input-control" type="password" autoComplete="current-password" value={signInPassword} onChange={(event) => setSignInPassword(event.target.value)} required />
            </label>
            {signInError && <p className="auth-error" role="alert">{signInError}</p>}
            <button className="button button-primary auth-submit" type="submit" disabled={signInBusy}>
              {signInBusy ? "Signing in…" : "Sign in to workspace"}
            </button>
          </form>
          <p className="auth-footnote">Workspace accounts are provisioned by an administrator.</p>
        </section>
      </main>
    );
  }

  if (workspaceLoading) {
    return <main className="auth-page"><section className="auth-panel"><h1>Loading shared workspace…</h1></section></main>;
  }

  if (workspaceError && !hydrated) {
    return (
      <main className="auth-page">
        <section className="auth-panel">
          <div className="auth-kicker">WORKSPACE UNAVAILABLE</div>
          <h1>Could not connect</h1>
          <p>{workspaceError}</p>
          <button type="button" className="button button-outline" onClick={() => void signOutUser()}>Sign out</button>
        </section>
      </main>
    );
  }

  return (
    <main className="workspace">
      <header className="topbar">
        <a className="brand-lockup" href="#" aria-label="TechGajana invoice home">
          <Image
            src="/techgajana-logo.png"
            alt="Tech Gajana — A Journey Toward Eleventh Dimension"
            width={813}
            height={632}
            priority
            className="brand-logo"
          />
          <span className="brand-name">Invoice Studio</span>
        </a>
        <div className="topbar-spacer" />
        <div className="local-badge"><span /> Shared cloud workspace</div>
        <span className="cloud-user">{user.email}</span>
        <button type="button" className="button button-outline" onClick={() => void signOutUser()}>Sign out</button>
      </header>

      {workspaceError && <div className="cloud-warning" role="alert">{workspaceError}</div>}

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

          <Section title="Company details">
            <div className="section-grid">
              <Field label="Company name" className="span-2">
                <TextInput value={invoice.company.name} onChange={(event) => updateArea("company", { name: event.target.value })} placeholder="Company name" />
              </Field>
              <Field label="Business type">
                <TextInput value={invoice.company.businessType} onChange={(event) => updateArea("company", { businessType: event.target.value })} placeholder="Software & IT services" />
              </Field>
              <Field label="Email">
                <TextInput type="email" value={invoice.company.email} onChange={(event) => updateArea("company", { email: event.target.value })} placeholder="hello@company.com" />
              </Field>
              <Field label="Business address" className="span-2">
                <TextArea rows={2} value={invoice.company.address} onChange={(event) => updateArea("company", { address: event.target.value })} placeholder="Street, city, state, PIN code" />
              </Field>
              <Field label="Phone">
                <TextInput value={invoice.company.phone} onChange={(event) => updateArea("company", { phone: event.target.value })} placeholder="+91 00000 00000" />
              </Field>
              <Field label="Website">
                <TextInput value={invoice.company.website} onChange={(event) => updateArea("company", { website: event.target.value })} placeholder="www.example.com" />
              </Field>
              <Field label="GSTIN (optional)">
                <TextInput value={invoice.company.gstin} onChange={(event) => updateArea("company", { gstin: event.target.value })} placeholder="GST registration number" />
              </Field>
              <Field label="PAN (optional)">
                <TextInput value={invoice.company.pan} onChange={(event) => updateArea("company", { pan: event.target.value })} placeholder="PAN" />
              </Field>
            </div>
            <div className="upload-row">
              <div><span className="upload-label">COMPANY LOGO</span>{assetControl("logo", invoice.company.logo, "Add logo")}</div>
              <div><span className="upload-label">AUTHORIZED SIGNATURE</span>{assetControl("signature", invoice.company.signature, "Add signature")}</div>
              <div><span className="upload-label">COMPANY STAMP</span>{assetControl("stamp", invoice.company.stamp, "Add stamp")}</div>
            </div>
          </Section>

          <Section title="Client details" defaultOpen>
            <div className="section-grid">
              <Field label="Client / company name" className="span-2">
                <TextInput value={invoice.client.name} onChange={(event) => updateArea("client", { name: event.target.value })} placeholder="Client company name" />
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
              <Field label="Contact person">
                <TextInput value={invoice.client.contact} onChange={(event) => updateArea("client", { contact: event.target.value })} placeholder="Name" />
              </Field>
              <Field label="Email">
                <TextInput type="email" value={invoice.client.email} onChange={(event) => updateArea("client", { email: event.target.value })} placeholder="client@company.com" />
              </Field>
              <Field label="Billing address" className="span-2">
                <TextArea rows={2} value={invoice.client.address} onChange={(event) => updateArea("client", { address: event.target.value })} placeholder="Street, city, state, PIN code" />
              </Field>
              <Field label="Phone">
                <TextInput value={invoice.client.phone} onChange={(event) => updateArea("client", { phone: event.target.value })} placeholder="+91 00000 00000" />
              </Field>
              <Field label="GSTIN (optional)">
                <TextInput value={invoice.client.gstin} onChange={(event) => updateArea("client", { gstin: event.target.value })} placeholder="Client GSTIN" />
              </Field>
              <Field label="State">
                <TextInput value={invoice.client.state} onChange={(event) => updateArea("client", { state: event.target.value })} placeholder="State" />
              </Field>
              <Field label="Place of supply">
                <TextInput value={invoice.client.placeOfSupply} onChange={(event) => updateArea("client", { placeOfSupply: event.target.value })} placeholder="State / territory" />
              </Field>
            </div>
            <button type="button" className="text-button save-client-action" onClick={saveClient}><Icon name="save" size={14} /> Save client for later</button>
          </Section>

          <Section title="Invoice information" defaultOpen>
            <div className="section-grid">
              <Field label="Invoice number">
                <TextInput value={invoice.details.number} onChange={(event) => updateArea("details", { number: event.target.value })} />
              </Field>
              <Field label="Invoice type">
                <SelectInput value={invoice.details.type} onChange={(event) => updateArea("details", { type: event.target.value as InvoiceData["details"]["type"] })}>
                  <option>Tax Invoice</option><option>Invoice</option><option>Proforma Invoice</option>
                </SelectInput>
              </Field>
              <Field label="Invoice date">
                <TextInput type="date" value={invoice.details.date} onChange={(event) => updateArea("details", { date: event.target.value })} />
              </Field>
              <Field label="Due date">
                <TextInput type="date" value={invoice.details.dueDate} onChange={(event) => updateArea("details", { dueDate: event.target.value })} />
              </Field>
              <Field label="Currency">
                <SelectInput value={invoice.details.currency} onChange={(event) => updateArea("details", { currency: event.target.value })}>
                  <option value="INR">INR — Indian Rupee (₹)</option>
                  <option value="USD">USD — US Dollar ($)</option>
                  <option value="EUR">EUR — Euro (€)</option>
                  <option value="GBP">GBP — British Pound (£)</option>
                </SelectInput>
              </Field>
              <Field label="Place of supply">
                <TextInput value={invoice.details.placeOfSupply} onChange={(event) => updateArea("details", { placeOfSupply: event.target.value })} placeholder="Optional" />
              </Field>
              <Field label="Purchase order no.">
                <TextInput value={invoice.details.purchaseOrder} onChange={(event) => updateArea("details", { purchaseOrder: event.target.value })} placeholder="Optional" />
              </Field>
              <label className="toggle-field">
                <span><strong>Reverse charge</strong><small>Applicable to this invoice</small></span>
                <input type="checkbox" checked={invoice.details.reverseCharge} onChange={(event) => updateArea("details", { reverseCharge: event.target.checked })} />
              </label>
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
                      <Field label="SAC / HSN">
                        <TextInput value={item.code} onChange={(event) => updateItem(item.id, { code: event.target.value })} placeholder="Optional" />
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

          <Section title="Payment & advance">
            <div className="section-grid">
              <Field label="Advance amount paid">
                <TextInput type="number" min="0" step="0.01" value={invoice.payment.advance} onChange={(event) => updateArea("payment", { advance: Number(event.target.value) })} />
              </Field>
              <Field label="Payment date">
                <TextInput type="date" value={invoice.payment.date} onChange={(event) => updateArea("payment", { date: event.target.value })} />
              </Field>
              <Field label="Payment method">
                <SelectInput value={invoice.payment.method} onChange={(event) => updateArea("payment", { method: event.target.value as InvoiceData["payment"]["method"] })}>
                  <option>UPI</option><option>Bank Transfer</option><option>Cash</option><option>Other</option>
                </SelectInput>
              </Field>
              <Field label="Transaction ID / UTR">
                <TextInput value={invoice.payment.transactionId} onChange={(event) => updateArea("payment", { transactionId: event.target.value })} placeholder="Optional reference" />
              </Field>
            </div>
            <div className="payment-status-row">
              <span>Payment status</span><span className={`status-pill status-${totals.status.toLowerCase().replace(" ", "-")}`}><span />{totals.status}</span>
            </div>
            <div className="proof-upload">
              <span className="upload-label">PAYMENT PROOF{invoice.payment.proofs.length > 0 ? ` · ${invoice.payment.proofs.length}` : ""}</span>
              <div className="proof-list">
                {invoice.payment.proofs.map((proof) => (
                  <div className="proof-file-row" key={proof.id}>
                    <span className="proof-type"><Icon name="file" size={15} /></span><span className="asset-name">{proof.name}</span>
                    <button type="button" className="icon-button danger-hover" onClick={() => removeAsset("proof", proof.id)} aria-label={`Remove ${proof.name}`}><Icon name="close" size={14} /></button>
                  </div>
                ))}
                <button type="button" className="upload-button compact-upload" onClick={() => fileInputs.current.proof?.click()}><span className="upload-icon"><Icon name="add" size={15} /></span><span><strong>Add receipt or screenshot</strong><small>PNG, JPG, WebP, PDF</small></span></button>
                <input ref={(element) => { fileInputs.current.proof = element; }} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(event) => void handleUpload("proof", event)} hidden />
              </div>
            </div>
          </Section>

          <Section title="Bank details">
            <div className="section-grid">
              <Field label="Account holder name"><TextInput value={invoice.bank.accountHolder} onChange={(event) => updateArea("bank", { accountHolder: event.target.value })} placeholder="Account holder" /></Field>
              <Field label="Bank name"><TextInput value={invoice.bank.bankName} onChange={(event) => updateArea("bank", { bankName: event.target.value })} placeholder="Bank name" /></Field>
              <Field label="Account number"><TextInput value={invoice.bank.accountNumber} onChange={(event) => updateArea("bank", { accountNumber: event.target.value })} placeholder="Account number" /></Field>
              <Field label="IFSC code"><TextInput value={invoice.bank.ifsc} onChange={(event) => updateArea("bank", { ifsc: event.target.value })} placeholder="IFSC" /></Field>
              <Field label="UPI ID"><TextInput value={invoice.bank.upiId} onChange={(event) => updateArea("bank", { upiId: event.target.value })} placeholder="name@bank" /></Field>
              <Field label="Payment QR code"><div className="qr-upload">{assetControl("qr", invoice.bank.qrCode, "Add QR code")}</div></Field>
            </div>
          </Section>

          <Section title={`Terms & conditions (${invoice.terms.length})`}>
            <div className="terms-editor">
              {invoice.terms.map((term, index) => (
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

          <Section title="Signatory details">
            <div className="section-grid">
              <Field label="Authorized signatory"><TextInput value={invoice.company.signatory} onChange={(event) => updateArea("company", { signatory: event.target.value })} placeholder="Name" /></Field>
              <Field label="Designation"><TextInput value={invoice.company.designation} onChange={(event) => updateArea("company", { designation: event.target.value })} placeholder="Director, etc." /></Field>
            </div>
          </Section>

          <div className="editor-footer-note"><span className="privacy-lock">⌑</span> Your invoices and uploads stay in this browser. Nothing is sent to a server.</div>
        </div>

        <div className="preview-column">
          <div className="preview-header">
            <h2>Preview</h2>
            <span className="preview-page-label">Updates as you type</span>
          </div>
          <div className="preview-frame">
            <InvoicePreview invoice={invoice} totals={totals} assetUrls={assetUrls} />
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
  assetUrls,
}: {
  invoice: InvoiceData;
  totals: ReturnType<typeof calculateTotals>;
  assetUrls: Record<string, string>;
}) {
  const shownDate = (value: string) => value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
  const asset = (file?: StoredAsset) => file ? assetUrls[file.id] : undefined;
  const fmt = (value: number) => formatCurrency(value, invoice.details.currency);
  const gstEnabled = invoice.gstEnabled !== false;
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
          {asset(invoice.company.logo) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="paper-logo" src={asset(invoice.company.logo)} alt={`${invoice.company.name} logo`} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="paper-logo paper-brand-logo" src="/techgajana-logo.png" alt="Tech Gajana logo" />
          )}
          <div className="paper-company-info">
            <strong>{invoice.company.name || "Company name"}</strong>
            {invoice.company.businessType && <span>{invoice.company.businessType}</span>}
            {invoice.company.address && <span>{invoice.company.address}</span>}
            <span className="paper-contact-line">{[invoice.company.email, invoice.company.phone].filter(Boolean).join("  ·  ")}</span>
            {invoice.company.website && <span>{invoice.company.website}</span>}
            {invoice.company.gstin && <span>GSTIN: {invoice.company.gstin}</span>}
            {invoice.company.pan && <span>PAN: {invoice.company.pan}</span>}
          </div>
        </div>
        <div className="paper-title-block">
          <span className="paper-type">{invoice.details.type.toUpperCase()}</span>
          <h2>INVOICE</h2>
          <span className="paper-invoice-number">#{invoice.details.number || "—"}</span>
        </div>
      </header>

      <div className="paper-rule" />
      <section className="paper-meta-grid">
        <div className="paper-meta-item"><span>INVOICE DATE</span><strong>{shownDate(invoice.details.date)}</strong></div>
        <div className="paper-meta-item"><span>DUE DATE</span><strong>{shownDate(invoice.details.dueDate)}</strong></div>
        <div className="paper-meta-item"><span>PAYMENT STATUS</span><strong className={`paper-status paper-${totals.status.toLowerCase().replace(" ", "-")}`}>{totals.status}</strong></div>
        {invoice.details.purchaseOrder && <div className="paper-meta-item"><span>PURCHASE ORDER</span><strong>{invoice.details.purchaseOrder}</strong></div>}
      </section>

      <section className="paper-billto">
        <div className="paper-section-label"><span className="paper-section-marker" /> BILL TO</div>
        <strong className="paper-client-name">{invoice.client.name || "Client / Company name"}</strong>
        {invoice.client.contact && <span>Attn: {invoice.client.contact}</span>}
        {invoice.client.address && <span>{invoice.client.address}</span>}
        {invoice.client.email && <span>{invoice.client.email}</span>}
        {invoice.client.phone && <span>{invoice.client.phone}</span>}
        {invoice.client.gstin && <span>GSTIN: {invoice.client.gstin}</span>}
        {(invoice.client.state || invoice.client.placeOfSupply || invoice.details.placeOfSupply) && (
          <span>Place of supply: {[invoice.client.placeOfSupply || invoice.details.placeOfSupply, invoice.client.state].filter(Boolean).join(", ")}</span>
        )}
        {invoice.details.reverseCharge && <span>Reverse charge applicable</span>}
      </section>

      <div className="paper-table-wrap">
        <table className="paper-items-table">
          <thead><tr><th className="col-number">#</th><th className="col-description">DESCRIPTION</th><th className="col-code">SAC/HSN</th><th className="col-qty">QTY</th><th className="col-rate">RATE</th>{gstEnabled && <th className="col-tax">GST</th>}<th className="col-amount">AMOUNT</th></tr></thead>
          <tbody>
            {invoice.items.map((item, index) => {
              const amounts = itemAmounts(item, gstEnabled);
              return (
                <tr key={item.id}>
                  <td className="col-number">{String(index + 1).padStart(2, "0")}</td>
                  <td className="col-description"><strong>{item.description || "Service description"}</strong>{item.project && <small>{item.project}</small>}</td>
                  <td className="col-code">{item.code || "—"}</td>
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
          <div className="paper-section-label"><span className="paper-section-marker" /> PAYMENT DETAILS</div>
          <div className="paper-payment-method"><span className="payment-method-icon">{invoice.payment.method === "UPI" ? "↗" : "₹"}</span><span><strong>{invoice.payment.advance > 0 ? `Advance via ${invoice.payment.method}` : "Payment information"}</strong><small>{invoice.payment.transactionId || "Use bank transfer or UPI"}</small></span></div>
          {(invoice.bank.accountHolder || invoice.bank.bankName || invoice.bank.accountNumber || invoice.bank.ifsc || invoice.bank.upiId) && (
            <div className="paper-bank-details">
              {invoice.bank.accountHolder && <span><small>ACCOUNT NAME</small>{invoice.bank.accountHolder}</span>}
              {invoice.bank.bankName && <span><small>BANK</small>{invoice.bank.bankName}</span>}
              {invoice.bank.accountNumber && <span><small>ACCOUNT NO.</small>{invoice.bank.accountNumber}</span>}
              {invoice.bank.ifsc && <span><small>IFSC</small>{invoice.bank.ifsc}</span>}
              {invoice.bank.upiId && <span><small>UPI ID</small>{invoice.bank.upiId}</span>}
            </div>
          )}
          {asset(invoice.bank.qrCode) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="paper-qr" src={asset(invoice.bank.qrCode)} alt="Payment QR code" />
          )}
          {invoice.payment.advance > 0 && (
            <div className="paper-advance-note">Advance of <strong>{fmt(invoice.payment.advance)}</strong> received on {shownDate(invoice.payment.date)}{invoice.payment.transactionId ? ` · Ref ${invoice.payment.transactionId}` : ""}.</div>
          )}
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
          <div className="paper-grand-total"><span>TOTAL DUE</span><strong>{fmt(totals.grandTotal)}</strong></div>
          {invoice.payment.advance > 0 && <div className="paper-total-row paper-advance-total"><span>Advance paid</span><strong>− {fmt(invoice.payment.advance)}</strong></div>}
          <div className="paper-balance"><span>Balance due</span><strong>{fmt(totals.balanceDue)}</strong></div>
        </div>
      </div>

      {invoice.terms.length > 0 && (
        <section className="paper-terms">
          <div className="paper-section-label"><span className="paper-section-marker" /> TERMS & CONDITIONS</div>
          <ol>{invoice.terms.filter((term) => term.trim()).map((term, index) => <li key={`${index}-${term}`}>{term}</li>)}</ol>
        </section>
      )}

      <footer className="paper-footer">
        <div className="paper-thank-you"><span>THANK YOU FOR YOUR BUSINESS</span><strong>We appreciate the opportunity to work with you.</strong></div>
        <div className="paper-signature-block">
          <div className="paper-sign-images">
            {asset(invoice.company.signature) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={asset(invoice.company.signature)} alt="Authorized signature" />
            )}
            {asset(invoice.company.stamp) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={asset(invoice.company.stamp)} alt="Company stamp" />
            )}
          </div>
          <div className="paper-sign-line" />
          <strong>{invoice.company.signatory || "Authorized signatory"}</strong>
          <span>{invoice.company.designation || "For " + (invoice.company.name || "Company")}</span>
        </div>
      </footer>
      <div className="paper-bottom-rule"><span>{invoice.company.name || "TechGajana Private Limited"}</span><span>{invoice.details.number || "—"}</span></div>
    </article>
    {invoice.payment.proofs.map((proof, index) => {
      const proofUrl = asset(proof);
      return (
        <article className="receipt-paper" data-pdf-page-index={index + 1} key={proof.id}>
          <div className="paper-top-accent" />
          <header className="receipt-page-header">
            <div>
              <div className="paper-section-label"><span className="paper-section-marker" /> PAYMENT RECEIPT</div>
              <h2>{proof.name}</h2>
            </div>
            <span className="receipt-invoice-number">Invoice #{invoice.details.number || "—"}</span>
          </header>
          <div className="receipt-page-meta">
            <span><strong>Received from</strong>{invoice.client.name || "Client / Company name"}</span>
            {invoice.payment.advance > 0 && <span><strong>Amount received</strong>{fmt(invoice.payment.advance)}</span>}
            {invoice.payment.date && <span><strong>Payment date</strong>{shownDate(invoice.payment.date)}</span>}
            {invoice.payment.transactionId && <span><strong>Transaction ID</strong>{invoice.payment.transactionId}</span>}
          </div>
          <div className="receipt-page-content">
            {proof.type === "application/pdf" ? (
              <div className="paper-pdf-attachment"><Icon name="file" size={22} /><span><strong>{proof.name}</strong><small>PDF receipt attachment reference</small></span></div>
            ) : proofUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="receipt-page-image" src={proofUrl} alt={`Payment receipt: ${proof.name}`} />
            ) : (
              <div className="paper-pdf-attachment"><Icon name="file" size={22} /><span><strong>{proof.name}</strong><small>Receipt attachment</small></span></div>
            )}
          </div>
        </article>
      );
    })}
    </div>
  );
}
