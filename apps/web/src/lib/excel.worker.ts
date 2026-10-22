/* Lee el Excel en segundo plano (Web Worker): por pesado que sea el archivo, la pantalla sigue
   respondiendo. Guarda el archivo en memoria mientras está abierto, por si el usuario cambia el
   tipo de archivo a mano y hay que volver a leerlo. */
import { peekWorkbook, readDataset, type CampaignCode, type Detection, type WorkbookReader, type XLSXReader } from "@crm/core";

export type WorkerRequest = { type: "open"; id: number; buf: ArrayBuffer; campaign: CampaignCode } | { type: "analyze"; id: number; datasetId: string };
export type WorkerResponse =
  | { type: "step"; id: number; message: string }
  | { type: "done"; id: number; result: import("@crm/core").ExcelReading; sha?: string }
  | { type: "fail"; id: number; message: string };

interface Scope {
  postMessage(m: WorkerResponse): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  importScripts?: (...urls: string[]) => void;
  XLSX?: XLSXReader;
}
const scope = self as unknown as Scope;
const LIB = "/vendor/xlsx-0.18.5.full.min.js";

let open: { data: Uint8Array; campaign: CampaignCode; reader: WorkbookReader; detections: Detection[] } | null = null;

async function lib(): Promise<XLSXReader> {
  if (scope.XLSX) return scope.XLSX;
  try {
    scope.importScripts!(LIB);
  } catch {
    // Worker de tipo módulo (modo desarrollo): se evalúa el mismo archivo en el ámbito global.
    const code = await (await fetch(LIB)).text();
    (0, eval)(code);
  }
  if (!scope.XLSX) throw new Error("No se pudo iniciar el lector de Excel.");
  return scope.XLSX;
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

scope.onmessage = async (e) => {
  const msg = e.data;
  const step = (message: string) => scope.postMessage({ type: "step", id: msg.id, message });
  try {
    const XLSX = await lib();
    if (msg.type === "open") {
      open = null;
      step("Abriendo el archivo…");
      const sha = hex(await crypto.subtle.digest("SHA-256", msg.buf));
      const data = new Uint8Array(msg.buf);
      step("Reconociendo el tipo de archivo…");
      const { reader, detections } = peekWorkbook(XLSX, data, msg.campaign);
      open = { data, campaign: msg.campaign, reader, detections };
      const result = readDataset(XLSX, data, msg.campaign, reader, detections, detections[0]?.datasetId ?? null, step);
      scope.postMessage({ type: "done", id: msg.id, result, sha });
    } else {
      if (!open) throw new Error("Vuelve a elegir el archivo.");
      const result = readDataset(XLSX, open.data, open.campaign, open.reader, open.detections, msg.datasetId, step);
      scope.postMessage({ type: "done", id: msg.id, result });
    }
  } catch (err) {
    scope.postMessage({ type: "fail", id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
