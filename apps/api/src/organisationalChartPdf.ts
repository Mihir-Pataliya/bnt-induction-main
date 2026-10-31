interface ChartPdfInput {
  companyName: string;
  dateCompleted: string;
  roles: Array<{ id: string; title: string; notApplicable: boolean; employeeName: string }>;
}

const escapeText = (value: string) => value.normalize("NFKD").replace(/[^\x20-\x7e]/g, "?").replace(/([\\()])/g, "\\$1");

export function generateOrganisationalChartPdf(input: ChartPdfInput): Buffer {
  const pages: string[] = [];
  const text = (x: number, y: number, value: string, size = 11) => `BT /F1 ${size} Tf ${x} ${y} Td (${escapeText(value)}) Tj ET`;
  const wrap = (value: string, width: number) => value.match(new RegExp(`.{1,${width}}(?:\\s|$)|.{1,${width}}`, "g"))?.map((line) => line.trim()) ?? [""];
  const box = (x: number, y: number, width: number, role: ChartPdfInput["roles"][number]) => {
    const lines = ["0.08 0.15 0.25 rg", `${x} ${y} ${width} 70 re f`, "0.18 0.83 0.73 RG", `${x} ${y} ${width} 70 re S`, "1 1 1 rg"];
    wrap(role.title, 29).forEach((line, index) => lines.push(text(x + 12, y + 52 - index * 12, line, 10)));
    lines.push("0.4 0.9 0.8 rg");
    wrap(role.notApplicable ? "N/A" : role.employeeName, 30).slice(0, 2).forEach((line, index) => lines.push(text(x + 12, y + 23 - index * 12, line, 10)));
    return lines.join("\n");
  };
  const header = () => ["0.035 0.07 0.13 rg 0 0 842 595 re f", "1 1 1 rg", text(40, 550, "ORGANISATIONAL CHART", 22), ...wrap(input.companyName, 90).map((line, i) => text(40, 523 - i * 14, line, 12)), text(40, 478, `Date completed: ${input.dateCompleted}`, 10), "0.18 0.83 0.73 RG 1 w"];
  const fixed = input.roles.filter((role) => !role.id.startsWith("driver-"));
  const drivers = input.roles.filter((role) => role.id.startsWith("driver-"));
  const commands = header();
  commands.push("421 350 m 421 375 l S", "161 350 m 681 350 l S");
  fixed.slice(1, 4).forEach((role, i) => { const x = 41 + i * 260; commands.push(`${x + 120} 330 m ${x + 120} 350 l S`, box(x, 260, 240, role)); });
  commands.push(box(301, 375, 240, fixed[0]));
  fixed.slice(4, 7).forEach((role, i) => { const x = 41 + i * 260; commands.push(`${x + 120} 235 m ${x + 120} 260 l S`, box(x, 165, 240, role)); });
  commands.push("421 145 m 421 165 l S", "161 145 m 681 145 l S");
  drivers.slice(0, 3).forEach((role, i) => { const x = 41 + i * 260; commands.push(`${x + 120} 120 m ${x + 120} 145 l S`, box(x, 50, 240, role)); });
  pages.push(commands.join("\n"));
  for (let offset = 3; offset < drivers.length; offset += 12) {
    const extra = header();
    drivers.slice(offset, offset + 12).forEach((role, index) => extra.push(box(41 + (index % 3) * 260, 370 - Math.floor(index / 3) * 95, 240, role)));
    pages.push(extra.join("\n"));
  }
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  pages.forEach((content, index) => {
    content += `\n0.6 0.7 0.8 rg\n${text(40, 22, `BNT Logistics | COR - Inductions & Training | Page ${index + 1} of ${pages.length}`, 9)}`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`, `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`);
  });
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf, "ascii")); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}