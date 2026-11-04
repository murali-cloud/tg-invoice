import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const PDF_RENDER_WIDTH = 794;
const PDF_RENDER_HEIGHT = 1123;
const PDF_SCALE = 2;

export async function downloadInvoicePdf(element: HTMLElement, filename: string): Promise<void> {
  const page = element.querySelector<HTMLElement>("[data-pdf-page-index='0']");
  if (!page) {
    throw new Error("The invoice preview is empty.");
  }

  const invoiceCanvas = await html2canvas(page, {
    backgroundColor: "#ffffff",
    logging: false,
    scale: PDF_SCALE,
    useCORS: true,
    width: PDF_RENDER_WIDTH,
    windowWidth: 1200,
    onclone: (clonedDocument) => {
      const clonedPage = clonedDocument.querySelector<HTMLElement>("[data-pdf-page-index='0']");
      if (!clonedPage) {
        throw new Error("The invoice page could not be prepared for download.");
      }

      Object.assign(clonedPage.style, {
        width: `${PDF_RENDER_WIDTH}px`,
        maxWidth: `${PDF_RENDER_WIDTH}px`,
        minHeight: `${PDF_RENDER_HEIGHT}px`,
        height: "auto",
        margin: "0",
        overflow: "visible",
        boxShadow: "none",
        boxSizing: "border-box",
      });
      clonedPage.classList.add("invoice-pdf-page");

      const clonedLogo = clonedPage.querySelector<HTMLImageElement>(".paper-logo-crop");
      if (!clonedLogo) {
        throw new Error("The company logo could not be prepared for download.");
      }
      clonedLogo.removeAttribute("srcset");
      clonedLogo.removeAttribute("sizes");
      clonedLogo.src = new URL("/techgajana-mark.png", clonedDocument.baseURI).href;
      Object.assign(clonedLogo.style, {
        display: "block",
        width: "108px",
        minWidth: "108px",
        maxWidth: "108px",
        height: "85px",
        minHeight: "85px",
        maxHeight: "85px",
        flex: "0 0 108px",
        objectFit: "contain",
        objectPosition: "center",
        overflow: "visible",
      });

      const pdfStyles = clonedDocument.createElement("style");
      pdfStyles.textContent = `
        .invoice-pdf-page { box-sizing: border-box !important; padding: 32px 48px 28px !important; display: flex !important; flex-direction: column !important; justify-content: flex-start !important; font-size: 12px !important; line-height: 1.4 !important; }
        .invoice-pdf-page .paper-header { width: 100% !important; min-width: 0 !important; gap: 18px !important; align-items: center !important; }
        .invoice-pdf-page .paper-company { flex: 1 1 0% !important; min-width: 0 !important; max-width: none !important; gap: 14px !important; }
        .invoice-pdf-page .paper-company-info { min-width: 0 !important; overflow-wrap: anywhere !important; }
        .invoice-pdf-page .paper-title-block { flex: 0 0 auto !important; min-width: 142px !important; max-width: 170px !important; padding-right: 3px !important; white-space: normal !important; }
        .invoice-pdf-page .paper-title-block h2 { white-space: normal !important; }
        .invoice-pdf-page .paper-invoice-number { display: block !important; white-space: normal !important; overflow-wrap: anywhere !important; }
        .invoice-pdf-page .paper-logo-crop { display: block !important; width: 108px !important; min-width: 108px !important; max-width: 108px !important; height: 85px !important; min-height: 85px !important; max-height: 85px !important; flex: 0 0 108px !important; object-fit: contain !important; object-position: center !important; overflow: visible !important; }
        .invoice-pdf-page .paper-company-info { gap: 3px !important; font-size: 12px !important; }
        .invoice-pdf-page .paper-company-info > strong { font-size: 16px !important; }
        .invoice-pdf-page .paper-title-block h2 { font-size: 27px !important; }
        .invoice-pdf-page .paper-invoice-number { font-size: 10px !important; }
        .invoice-pdf-page .paper-rule { margin: 16px 0 14px !important; }
        .invoice-pdf-page .paper-meta-grid { padding: 10px 12px !important; }
        .invoice-pdf-page .paper-meta-item { gap: 5px !important; }
        .invoice-pdf-page .paper-meta-item > span { font-size: 9px !important; }
        .invoice-pdf-page .paper-meta-item > strong { font-size: 12px !important; }
        .invoice-pdf-page .paper-status { font-size: 12px !important; }
        .invoice-pdf-page .paper-billto { gap: 4px !important; margin: 18px 0 16px !important; font-size: 11px !important; }
        .invoice-pdf-page .paper-billto-details { display: flex !important; flex-direction: column !important; gap: 4px !important; margin-left: 10px !important; }
        .invoice-pdf-page .paper-section-label { align-items: center !important; gap: 8px !important; margin-bottom: 9px !important; color: #565b64 !important; font-size: 12px !important; font-weight: 800 !important; line-height: 14px !important; letter-spacing: normal !important; }
        .invoice-pdf-page .paper-section-marker { display: block !important; width: 4px !important; height: 12px !important; flex: 0 0 4px !important; }
        .invoice-pdf-page .paper-client-name { font-size: 14px !important; }
        .invoice-pdf-page .paper-items-table { width: 100% !important; max-width: 100% !important; }
        .invoice-pdf-page .paper-items-table th { padding: 9px 5px !important; font-size: 9px !important; }
        .invoice-pdf-page .paper-items-table td { padding: 10px 5px !important; font-size: 11px !important; }
        .invoice-pdf-page .paper-items-table td strong { font-size: 11px !important; }
        .invoice-pdf-page .paper-items-table .col-amount { white-space: nowrap !important; }
        .invoice-pdf-page .paper-items-table td.col-amount strong { display: inline !important; white-space: nowrap !important; }
        .invoice-pdf-page .paper-items-table td small,
        .invoice-pdf-page .paper-items-table td span { font-size: 9px !important; }
        .invoice-pdf-page .paper-table-wrap { width: 100% !important; min-width: 0 !important; overflow: visible !important; }
        .invoice-pdf-page .paper-bottom-grid { width: 100% !important; min-width: 0 !important; grid-template-columns: 1.05fr .95fr !important; gap: 22px !important; margin-top: 20px !important; }
        .invoice-pdf-page .paper-payment { padding: 16px 18px !important; }
        .invoice-pdf-page .paper-payment > .paper-section-label { justify-content: center !important; }
        .invoice-pdf-page .paper-payment-content { width: 100% !important; max-width: 340px !important; margin: 0 auto !important; }
        .invoice-pdf-page .paper-payment-list { gap: 9px !important; }
        .invoice-pdf-page .paper-payment-row { gap: 3px 8px !important; font-size: 12px !important; }
        .invoice-pdf-page .paper-payment-row strong { font-size: 12px !important; font-weight: 700 !important; }
        .invoice-pdf-page .paper-advance-note { font-size: 12px !important; font-weight: 600 !important; }
        .invoice-pdf-page .paper-total-row,
        .invoice-pdf-page .paper-balance { font-size: 11px !important; }
        .invoice-pdf-page .paper-payment-row small { font-size: 11px !important; }
        .invoice-pdf-page .paper-total-row { padding: 4px 0 !important; }
        .invoice-pdf-page .paper-grand-total { padding: 8px 0 6px !important; font-size: 10px !important; }
        .invoice-pdf-page .paper-grand-total strong { font-size: 17px !important; }
        .invoice-pdf-page .paper-balance { padding: 8px 9px !important; }
        .invoice-pdf-page .paper-balance strong { font-size: 13px !important; }
        .invoice-pdf-page .paper-terms { margin-top: 20px !important; padding-top: 13px !important; }
        .invoice-pdf-page .paper-terms ol { column-gap: 18px !important; row-gap: 5px !important; font-size: 11px !important; line-height: 1.4 !important; }
        .invoice-pdf-page .paper-terms li::marker { font-size: 8px !important; }
        .invoice-pdf-page .paper-footer { flex-direction: column !important; align-items: center !important; gap: 12px !important; min-height: 0 !important; margin-top: 18px !important; padding-top: 14px !important; }
        .invoice-pdf-page .paper-thank-you { align-items: center !important; gap: 4px !important; text-align: center !important; }
        .invoice-pdf-page .paper-thank-you > span,
        .invoice-pdf-page .paper-thank-you > strong,
        .invoice-pdf-page .paper-signature-block > strong,
        .invoice-pdf-page .paper-signature-block > span { font-size: 10px !important; }
        .invoice-pdf-page .paper-thank-you > span { letter-spacing: .2px !important; }
        .invoice-pdf-page .paper-signature-block { width: min(260px, 100%) !important; min-width: 0 !important; align-items: flex-end !important; align-self: flex-end !important; text-align: right !important; }
        .invoice-pdf-page .paper-sign-images { height: 88px !important; margin-bottom: -2px !important; align-items: flex-end !important; overflow: visible !important; }
        .invoice-pdf-page .paper-sign-images { justify-content: flex-end !important; }
      `;
      clonedPage.appendChild(pdfStyles);
    },
  });

  if (invoiceCanvas.width === 0 || invoiceCanvas.height === 0) {
    throw new Error("The invoice page is empty.");
  }

  const pdfDocument = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const availableWidth = A4_WIDTH_MM;
  const availableHeight = A4_HEIGHT_MM;
  const imageRatio = invoiceCanvas.width / invoiceCanvas.height;
  const pageRatio = availableWidth / availableHeight;
  const imageWidth = imageRatio > pageRatio ? availableWidth : availableHeight * imageRatio;
  const imageHeight = imageRatio > pageRatio ? availableWidth / imageRatio : availableHeight;

  pdfDocument.addImage(
    invoiceCanvas,
    "JPEG",
    (A4_WIDTH_MM - imageWidth) / 2,
    (A4_HEIGHT_MM - imageHeight) / 2,
    imageWidth,
    imageHeight,
    undefined,
    "FAST",
  );

  pdfDocument.save(filename);
}
