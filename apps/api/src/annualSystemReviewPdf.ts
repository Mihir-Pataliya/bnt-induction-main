/**
 * Annual System Review — Due December PDF Generator.
 *
 * Pure Node.js PDF 1.4 generator. Embeds the BNT Logistics logo prominently at
 * the top of every page, large, clear, properly aligned and proportional without
 * stretching. The same logo asset (logo-data.ts) is reused for all pages.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LOGO_HEX = readFileSync(
  fileURLToPath(new URL("../../web/src/lib/logo-data.ts", import.meta.url)),
  "utf-8"
).match(/export const bntLogoHex = "([0-9a-fA-F]+)"/)?.[1] ?? "";

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

const logoJpgBytes = LOGO_HEX ? hexToBytes(LOGO_HEX) : new Uint8Array(0);

// Logo intrinsic aspect ratio from the embedded JPEG header (SOF0 segment).
// Width = 0x005c = 92, Height = 0x00ed = 237  →  ratio width/height ≈ 0.3882
const LOGO_WIDTH = 92;
const LOGO_HEIGHT = 237;
const LOGO_ASPECT = LOGO_WIDTH / LOGO_HEIGHT;

interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  gapBefore?: number;
  align?: "left" | "center" | "right";
}

interface AnnualSystemReviewPdfInput {
  reviewYear: number;
  company: Record<string, unknown>;
  requirements: Array<Record<string, unknown>>;
  followUp: Array<Record<string, unknown>>;
  acknowledgement: Record<string, unknown>;
  submittedAt: string | null;
}

function safeText(value: unknown): string {
  return String(value ?? "-")
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrap(text: string, maxLength: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > maxLength) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function pageContent(lines: PdfLine[], logoX: number, logoY: number, logoW: number, logoH: number): string {
  let y = 790;
  const commands: string[] = ["0.08 0.15 0.25 rg"];

  // ---- BNT Logistics Logo (top of page, large, clear, proportional) ----
  if (logoJpgBytes.length > 0) {
    commands.push("q");
    commands.push(`${logoW} 0 0 ${logoH} ${logoX} ${logoY} cm`);
    commands.push("/Logo Do");
    commands.push("Q");
    y -= logoH + 20;
  }

  for (const line of lines) {
    y -= line.gapBefore ?? 0;
    const size = line.size ?? 10;
    const wrapped = wrap(line.text, Math.max(40, Math.floor(515 / (size * 0.52))));
    for (const text of wrapped) {
      if (y < 60) break;
      const x = line.align === "center" ? 297.5 - (text.length * size * 0.28) : 42;
      commands.push(
        `BT /${line.bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${safeText(text)}) Tj ET`
      );
      y -= size + 5;
    }
  }
  return commands.join("\n");
}

export function generateAnnualSystemReviewPdf(input: AnnualSystemReviewPdfInput): Buffer {
  const lines: PdfLine[] = [];

  lines.push({ text: "ANNUAL SYSTEM REVIEW — DUE DECEMBER", size: 18, bold: true, gapBefore: 6, align: "center" });
  lines.push({ text: `Review Year: ${input.reviewYear}  |  CONFIDENTIAL - INTERNAL USE`, size: 10, gapBefore: 2, align: "center" });
  lines.push({ text: `Status: Submitted${input.submittedAt ? ` on ${new Date(input.submittedAt).toLocaleDateString("en-AU")}` : ""}`, size: 10, gapBefore: 3, align: "center" });

  lines.push({ text: "Company details", size: 14, bold: true, gapBefore: 14 });
  for (const [label, key] of [
    ["Company", "companyName"], ["ABN", "abn"], ["Address", "address"],
    ["Contact", "contactName"], ["Email", "email"], ["Phone", "phone"]
  ]) {
    lines.push({ text: `${label}: ${String(input.company[key] ?? "-")}` });
  }

  lines.push({ text: "Annual System Review requirements", size: 14, bold: true, gapBefore: 14 });
  for (const [index, req] of input.requirements.entries()) {
    lines.push({ text: `${index + 1}. ${String(req.title ?? "Requirement")}`, size: 11, bold: true, gapBefore: 7 });
    lines.push({ text: `Response: ${String(req.status ?? "-")}${String(req.notes ? ` | Notes: ${req.notes}` : "")}` });
  }

  lines.push({ text: "Follow Up — Corrective actions", size: 14, bold: true, gapBefore: 14 });
  if (input.followUp.length === 0) {
    lines.push({ text: "No follow-up actions recorded." });
  } else {
    for (const [index, action] of input.followUp.entries()) {
      lines.push({ text: `${index + 1}. ${String(action.correctiveAction ?? "Corrective action")}`, size: 10 });
      lines.push({ text: `   Responsible: ${String(action.responsiblePerson ?? "-")} | Due: ${String(action.dueDate ?? "-")} | Status: ${String(action.status ?? "-")}` });
    }
  }

  lines.push({ text: "Review Completed", size: 14, bold: true, gapBefore: 14 });
  lines.push({ text: `Reviewer name: ${String(input.acknowledgement.reviewerName ?? "-")}` });
  lines.push({ text: `Company role: ${String(input.acknowledgement.companyRole ?? "-")}` });
  lines.push({ text: `Signature: ${String(input.acknowledgement.signature ?? "-")}` });
  lines.push({ text: `Review date: ${String(input.acknowledgement.reviewDate ?? "-")}` });
  lines.push({ text: "Completed electronically by the named company representative.", size: 9, gapBefore: 5 });

  // Paginate
  const pageLines: PdfLine[][] = [];
  let current: PdfLine[] = [];
  let roughLineCount = 0;
  for (const line of lines) {
    const count = wrap(line.text, Math.max(40, Math.floor(515 / ((line.size ?? 10) * 0.52)))).length;
    const cost = count + (line.gapBefore ? 1 : 0);
    if (roughLineCount + cost > 40 && current.length) {
      pageLines.push(current);
      current = [];
      roughLineCount = 0;
    }
    current.push(line);
    roughLineCount += cost;
  }
  if (current.length) pageLines.push(current);

  const pageWidth = 595;
  const logoDisplayHeight = 70;
  const logoDisplayWidth = logoDisplayHeight * LOGO_ASPECT;
  const logoX = (pageWidth - logoDisplayWidth) / 2;
  const logoY = 800;

  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pageLines.length} /Kids [${pageLines.map((_, i) => `${5 + i * 2} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"
  ];

  let logoObjIndex: number | null = null;
  if (logoJpgBytes.length > 0) {
    logoObjIndex = 5 + pageLines.length * 2;
    objects.push(
      `<< /Type /XObject /Subtype /Image /Width ${LOGO_WIDTH} /Height ${LOGO_HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoJpgBytes.length} >>`
    );
  }

  pageLines.forEach((page, index) => {
    const pageNumber = 5 + index * 2;
    const contentNumber = pageNumber + 1;
    const content = pageContent(page, logoX, logoY, logoDisplayWidth, logoDisplayHeight);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${logoObjIndex ? ` /XObject << /Logo ${logoObjIndex} 0 R >>` : ""} >> /Contents ${contentNumber} 0 R >>`
    );
    objects.push(`<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`);
  });

  let textOnlyPdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(textOnlyPdf, "ascii"));
    if (logoObjIndex !== null && index === logoObjIndex - 1) {
      const header = `${index + 1} 0 obj << /Type /XObject /Subtype /Image /Width ${LOGO_WIDTH} /Height ${LOGO_HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoJpgBytes.length} >> stream\n`;
      textOnlyPdf += header;
      textOnlyPdf += "\nendstream\nendobj\n";
    } else {
      textOnlyPdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    }
  });

  const xrefOffset = Buffer.byteLength(textOnlyPdf, "ascii");
  textOnlyPdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    textOnlyPdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  textOnlyPdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const pdfBytes = Buffer.from(textOnlyPdf, "ascii");
  const streamMarker = Buffer.from("stream\n", "ascii");
  const endstreamMarker = Buffer.from("\nendstream", "ascii");

  let logoStreamPos = -1;
  for (let i = 0; i < pdfBytes.length - streamMarker.length; i++) {
    let match = true;
    for (let j = 0; j < streamMarker.length; j++) {
      if (pdfBytes[i + j] !== streamMarker[j]) { match = false; break; }
    }
    if (match) {
      const before = pdfBytes.subarray(Math.max(0, i - 200), i).toString("ascii");
      if (before.includes("/Filter /DCTDecode")) {
        logoStreamPos = i + streamMarker.length;
        break;
      }
    }
  }

  let finalPdf: Buffer;
  if (logoStreamPos !== -1 && logoJpgBytes.length > 0) {
    const endPos = pdfBytes.indexOf(endstreamMarker, logoStreamPos);
    if (endPos !== -1) {
      const before = pdfBytes.subarray(0, logoStreamPos);
      const after = pdfBytes.subarray(endPos);
      finalPdf = Buffer.concat([before, logoJpgBytes, after]);
    } else {
      finalPdf = pdfBytes;
    }
  } else {
    finalPdf = pdfBytes;
  }

  return finalPdf;
}