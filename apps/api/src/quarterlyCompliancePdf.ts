interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  gapBefore?: number;
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

function pageContent(lines: PdfLine[]): string {
  let y = 790;
  const commands = ["0.08 0.15 0.25 rg"];
  for (const line of lines) {
    y -= line.gapBefore ?? 0;
    const size = line.size ?? 10;
    const wrapped = wrap(line.text, Math.max(40, Math.floor(515 / (size * 0.52))));
    for (const text of wrapped) {
      if (y < 48) break;
      commands.push(
        `BT /${line.bold ? "F2" : "F1"} ${size} Tf 42 ${y.toFixed(2)} Td (${safeText(text)}) Tj ET`
      );
      y -= size + 5;
    }
  }
  return commands.join("\n");
}

export function generateQuarterlyCompliancePdf(input: {
  quarter: string;
  year: number;
  company: Record<string, unknown>;
  sections: Array<Record<string, unknown>>;
  acknowledgement: Record<string, unknown>;
  submittedAt: string | null;
}): Buffer {
  const lines: PdfLine[] = [
    { text: "BNT LOGISTICS", size: 10, bold: true },
    { text: "Quarterly Compliance Review", size: 20, bold: true, gapBefore: 5 },
    { text: `${input.quarter} ${input.year} | CONFIDENTIAL - INTERNAL USE`, size: 10, gapBefore: 4 },
    { text: `Status: Submitted${input.submittedAt ? ` on ${new Date(input.submittedAt).toLocaleDateString("en-AU")}` : ""}`, size: 10 },
    { text: "Company details", size: 14, bold: true, gapBefore: 12 }
  ];

  for (const [label, key] of [
    ["Operator", "operator"], ["ABN/ACN", "abn"], ["Year", "year"],
    ["Compliance Period", "compliancePeriod"]
  ]) {
    lines.push({ text: `${label}: ${String(input.company[key] ?? "-")}` });
  }

  const fieldLabels: Record<string, string> = {
    operator: "Operator",
    abn: "ABN/ACN",
    abnAcn: "ABN/ACN",
    year: "Year",
    compliancePeriod: "Compliance Period",
    vehiclesInFleet: "Number of vehicles in fleet, including trailers and subcontractors' vehicles",
    totalTrips: "Total trips completed",
    overweightTrips: "Total trips overweight to relevant mass limits",
    offRouteTrips: "Total trips detected off route",
    onTimeTrips: "Total trips delivered on time",
    defects: "Number of defects",
    infringements: "Number of infringements",
    onRoadIncidents: "Number of on-road incidents",
    totalNcrs: "Total number of Non-Conformance Reports completed",
    attachments: "Attached reports",
    calibrationCompleted: "Number of weight calibration/verification reports completed",
    calibrationNotCompleted: "Number not completed",
    dailyChecksCompleted: "Total daily checks completed",
    dailyChecksMissed: "Total daily checks not completed (missed pre-starts)",
    scheduledServicesCompleted: "Total scheduled vehicle services completed",
    scheduledServicesNotCompleted: "Total scheduled vehicle services not completed",
    totalFaultReports: "Total fault reports",
    faultRepairsNotCompleted: "Total fault repairs not completed, excluding correctly deferred repairs",
    totalEmployees: "Total company employees, including drivers",
    newInductions: "Total new company inductions completed",
    workDiaryPagesChecked: "Total work diary pages/local work records checked",
    nonCompliantWorkRestHours: "Total non-compliant work and rest hours",
    medicalsOnTime: "Number of driver medicals provided on time",
    speedBreaches: "Number of speed breaches detected",
    drugAlcoholTests: "Number of drug and alcohol tests completed",
    compliments: "Number of customer/client/community compliments",
    complaints: "Number of customer/client/community complaints",
    recurringClients: "Total number of recurring clients/customers",
    comments: "Comments"
  };

  lines.push({ text: "Quarterly review sections", size: 14, bold: true, gapBefore: 12 });
  for (const [index, section] of input.sections.entries()) {
    lines.push({ text: `${index + 1}. ${String(section.title ?? "Compliance section")}`, size: 11, bold: true, gapBefore: 7 });
    for (const [key, value] of Object.entries(section)) {
      if (key === "id" || key === "title") continue;
      const label = fieldLabels[key] ?? key;
      const display = Array.isArray(value) ? value.join(", ") || "-" : String(value ?? "-");
      lines.push({ text: `${label}: ${display}` });
    }
    if (Object.keys(section).filter((key) => key !== "id" && key !== "title").length === 0) {
      lines.push({ text: "No figures entered." });
    }
  }

  lines.push({ text: "Acknowledgement", size: 14, bold: true, gapBefore: 12 });
  lines.push({ text: `Name: ${String(input.acknowledgement.name ?? "-")}` });
  lines.push({ text: `Role: ${String(input.acknowledgement.role ?? "-")}` });
  lines.push({ text: `Signature: ${String(input.acknowledgement.signature ?? "-")}` });
  lines.push({ text: `Date: ${String(input.acknowledgement.date ?? "-")}` });
  lines.push({ text: "Submitted electronically by the named company representative.", size: 9, gapBefore: 5 });

  const pageLines: PdfLine[][] = [];
  let current: PdfLine[] = [];
  let roughLineCount = 0;
  for (const line of lines) {
    const count = wrap(line.text, Math.max(40, Math.floor(515 / ((line.size ?? 10) * 0.52)))).length;
    const cost = count + (line.gapBefore ? 1 : 0);
    if (roughLineCount + cost > 44 && current.length) {
      pageLines.push(current);
      current = [];
      roughLineCount = 0;
    }
    current.push(line);
    roughLineCount += cost;
  }
  if (current.length) pageLines.push(current);

  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pageLines.length} /Kids [${pageLines.map((_, i) => `${5 + i * 2} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"
  ];
  pageLines.forEach((page, index) => {
    const pageNumber = 5 + index * 2;
    const contentNumber = pageNumber + 1;
    const content = pageContent(page);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNumber} 0 R >>`
    );
    objects.push(`<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`);
  });

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}
