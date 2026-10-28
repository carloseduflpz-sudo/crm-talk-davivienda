/* Descarga de tablas a Excel. Usa el mismo SheetJS que lee los archivos, cargado solo al exportar. */

interface XLSXWriter {
  utils: {
    json_to_sheet(rows: Record<string, unknown>[], opts?: { header?: string[] }): Record<string, unknown>;
    book_new(): unknown;
    book_append_sheet(wb: unknown, ws: unknown, name: string): void;
  };
  writeFile(wb: unknown, name: string, opts?: Record<string, unknown>): void;
}

let loading: Promise<XLSXWriter> | null = null;

function loadWriter(): Promise<XLSXWriter> {
  const w = window as unknown as { XLSX?: XLSXWriter };
  if (w.XLSX) return Promise.resolve(w.XLSX);
  loading ??= new Promise<XLSXWriter>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/vendor/xlsx-0.18.5.full.min.js";
    s.async = true;
    s.onload = () => (w.XLSX ? resolve(w.XLSX) : reject(new Error("No se pudo preparar la descarga.")));
    s.onerror = () => {
      loading = null;
      reject(new Error("No se pudo preparar la descarga. Revisa tu conexión."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Descarga `rows` como .xlsx, con los encabezados en el orden y nombre de `columns`. */
export async function downloadExcel(fileName: string, sheet: string, columns: { key: string; label: string }[], rows: Record<string, unknown>[]) {
  const XLSX = await loadWriter();
  const data = rows.map((r) => Object.fromEntries(columns.map((c) => [c.label, r[c.key] ?? ""])));
  const ws = XLSX.utils.json_to_sheet(data, { header: columns.map((c) => c.label) });
  ws["!cols"] = columns.map((c) => ({ wch: Math.max(10, c.label.length + 2, ...data.slice(0, 200).map((r) => String(r[c.label] ?? "").length + 1)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
  XLSX.writeFile(wb, fileName.replace(/[\\/:*?"<>|]+/g, " ").trim(), { compression: true });
}

/** Varias hojas en un solo Excel (cada una con sus columnas). Las hojas sin filas llevan solo el encabezado. */
export async function downloadWorkbook(fileName: string, sheets: { name: string; columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }[]) {
  const XLSX = await loadWriter();
  const wb = XLSX.utils.book_new();
  for (const sh of sheets) {
    const data = sh.rows.map((r) => Object.fromEntries(sh.columns.map((c) => [c.label, r[c.key] ?? ""])));
    const ws = XLSX.utils.json_to_sheet(data, { header: sh.columns.map((c) => c.label) });
    ws["!cols"] = sh.columns.map((c) => ({ wch: Math.min(60, Math.max(10, c.label.length + 2, ...data.slice(0, 200).map((r) => String(r[c.label] ?? "").length + 1))) }));
    XLSX.utils.book_append_sheet(wb, ws, sh.name.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
  }
  XLSX.writeFile(wb, fileName.replace(/[\\/:*?"<>|]+/g, " ").trim(), { compression: true });
}
