/* Cliente del lector de Excel en segundo plano. Un lector por archivo abierto: al elegir otro
   archivo (o cancelar) se cierra el anterior y se libera toda su memoria al instante. */
import type { CampaignCode, ExcelReading } from "@crm/core";
import type { WorkerRequest, WorkerResponse } from "./excel.worker";

export class ReadCancelled extends Error {
  constructor() {
    super("Lectura cancelada.");
  }
}

const CRASH =
  "El navegador se quedó sin memoria leyendo este archivo. Cierra otras pestañas y vuelve a intentarlo; si sigue pasando, guarda una copia solo con la hoja de datos.";

/** Traduce los errores del lector a algo accionable. */
function friendly(message: string): string {
  if (/password|encrypt|ole2|cfb/i.test(message)) return "El archivo está protegido con contraseña. Quítale la contraseña en Excel y vuelve a cargarlo.";
  if (/unsupported|corrupt|zip|invalid|unexpected/i.test(message)) return "No pude abrir el archivo: parece dañado o no es un Excel. Ábrelo en Excel, guárdalo de nuevo y vuelve a intentarlo.";
  return message;
}

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

interface Pending {
  resolve: (v: { result: ExcelReading; sha?: string }) => void;
  reject: (e: Error) => void;
  onStep: (s: string) => void;
}

export class ExcelReader {
  private worker = new Worker(new URL("./excel.worker.ts", import.meta.url));
  private seq = 0;
  private pending = new Map<number, Pending>();
  private closed = false;

  constructor() {
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === "step") return p.onStep(m.message);
      this.pending.delete(m.id);
      if (m.type === "done") p.resolve({ result: m.result, sha: m.sha });
      else p.reject(new Error(friendly(m.message)));
    };
    // Un error sin capturar dentro del lector casi siempre es falta de memoria.
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.closed = true;
      this.worker.terminate();
      this.failAll(new Error(CRASH));
    };
  }

  private send(msg: WithoutId<WorkerRequest>, onStep: (s: string) => void, transfer: Transferable[] = []) {
    if (this.closed) return Promise.reject(new ReadCancelled());
    const id = ++this.seq;
    return new Promise<{ result: ExcelReading; sha?: string }>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onStep });
      this.worker.postMessage({ ...msg, id } as WorkerRequest, transfer);
    });
  }

  /** Abre el archivo, reconoce el tipo y lo lee completo. */
  async open(file: File, campaign: CampaignCode, onStep: (s: string) => void) {
    const buf = await file.arrayBuffer();
    // El archivo se transfiere (no se copia): la pantalla principal no carga con él.
    const r = await this.send({ type: "open", buf, campaign }, onStep, [buf]);
    return { result: r.result, sha: r.sha! };
  }

  /** Vuelve a leer el mismo archivo como otro tipo. */
  async analyze(datasetId: string, onStep: (s: string) => void) {
    return (await this.send({ type: "analyze", datasetId }, onStep)).result;
  }

  private failAll(e: Error) {
    for (const p of this.pending.values()) p.reject(e);
    this.pending.clear();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    this.failAll(new ReadCancelled());
  }
}
