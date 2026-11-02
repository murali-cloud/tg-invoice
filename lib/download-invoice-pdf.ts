import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const PDF_RENDER_WIDTH = 794;
const PDF_RENDER_HEIGHT = 1123;
const PDF_SCALE = 2;

export async function downloadInvoicePdf(element: HTMLElement, filename: string): Promise<void> {
  const pages = Array.from(element.querySelectorAll<HTMLElement>("[data-pdf-page-index]"));
  if (pages.length === 0) {
    throw new Error("The invoice preview is empty.");
  }

  const capturePage = async (page: HTMLElement, pageIndex: number) => {
    const canvas = await html2canvas(page, {
      backgroundColor: "#ffffff",
      logging: false,
      scale: PDF_SCALE,
      useCORS: true,
      width: PDF_RENDER_WIDTH,
      windowWidth: 1200,
      onclone: (clonedDocument) => {
        const clonedPage = clonedDocument.querySelector<HTMLElement>(`[data-pdf-page-index="${pageIndex}"]`);
        if (!clonedPage) {
          throw new Error("An invoice page could not be prepared for download.");
        }

        Object.assign(clonedPage.style, {
          width: `${PDF_RENDER_WIDTH}px`,
          maxWidth: `${PDF_RENDER_WIDTH}px`,
          minHeight: `${PDF_RENDER_HEIGHT}px`,
          margin: "0",
          overflow: "visible",
          boxShadow: "none",
        });
      },
    });

    if (canvas.width === 0 || canvas.height === 0) {
      throw new Error("An invoice page is empty.");
    }
    return canvas;
  };

  const invoiceCanvas = await capturePage(pages[0], 0);
  const pagePixelHeight = Math.round(PDF_RENDER_HEIGHT * PDF_SCALE);
  const invoicePageCount = Math.ceil(invoiceCanvas.height / pagePixelHeight);
  const pageCount = invoicePageCount + pages.length - 1;
  const pdfDocument = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });

  const addCanvasPage = (canvas: HTMLCanvasElement, sourceY: number, sliceHeight: number, pageNumber: number) => {
    const pageCanvas = window.document.createElement("canvas");
    pageCanvas.width = canvas.width;
    pageCanvas.height = sliceHeight;

    const context = pageCanvas.getContext("2d");
    if (!context) {
      throw new Error("The invoice PDF page could not be rendered.");
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    context.drawImage(
      canvas,
      0,
      sourceY,
      canvas.width,
      sliceHeight,
      0,
      0,
      canvas.width,
      sliceHeight,
    );

    const pageHeightMm = sliceHeight * A4_WIDTH_MM / canvas.width;
    pdfDocument.addImage(pageCanvas, "JPEG", 0, 0, A4_WIDTH_MM, pageHeightMm, undefined, "FAST");
    pdfDocument.setFont("helvetica", "normal");
    pdfDocument.setFontSize(7);
    pdfDocument.setTextColor("#888888");
    pdfDocument.text(`Page ${pageNumber} of ${pageCount}`, A4_WIDTH_MM - 14, A4_HEIGHT_MM - 5, { align: "right" });
  };

  let pageNumber = 0;
  for (let pageIndex = 0; pageIndex < invoicePageCount; pageIndex += 1) {
    if (pageNumber > 0) {
      pdfDocument.addPage("a4", "portrait");
    }
    const sourceY = pageIndex * pagePixelHeight;
    const sliceHeight = Math.min(pagePixelHeight, invoiceCanvas.height - sourceY);
    addCanvasPage(invoiceCanvas, sourceY, sliceHeight, ++pageNumber);
  }

  for (let index = 1; index < pages.length; index += 1) {
    const receiptCanvas = await capturePage(pages[index], index);
    pdfDocument.addPage("a4", "portrait");
    addCanvasPage(receiptCanvas, 0, Math.min(receiptCanvas.height, pagePixelHeight), ++pageNumber);
  }

  pdfDocument.save(filename);
}
