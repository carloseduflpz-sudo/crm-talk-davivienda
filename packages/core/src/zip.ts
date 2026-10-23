/* ZIP con varios archivos (p. ej. las tipificaciones de todo el año): se lee el directorio y cada
   archivo por separado, directo del archivo en disco, sin cargar ni descomprimir todo el ZIP en memoria. */
import type { CampaignCode } from "./campaigns";

export interface ZipEntry {
  /** Ruta dentro del ZIP ("TDC/Enero.xlsx"). */
  path: string;
  /** Solo el nombre del archivo ("Enero.xlsx"). */
  name: string;
  method: number;
  compSize: number;
  size: number;
  localOffset: number;
}

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

async function slice(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

/** Archivos del ZIP (sin carpetas ni basura de macOS/Excel). */
export async function listZip(blob: Blob): Promise<ZipEntry[]> {
  const tailLen = Math.min(blob.size, 65_557 + 22);
  const tail = await slice(blob, blob.size - tailLen, blob.size);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tail, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("No es un archivo ZIP o está dañado.");
  const count = u16(tail, eocd + 10);
  const cdSize = u32(tail, eocd + 12);
  const cdOffset = u32(tail, eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new Error("El ZIP es demasiado grande (formato ZIP64). Divídelo en ZIP de menos de 4 GB, por ejemplo uno por campaña.");
  }
  const cd = await slice(blob, cdOffset, cdOffset + cdSize);
  const utf8 = new TextDecoder("utf-8");
  const legacy = new TextDecoder("windows-1252");
  const out: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (u32(cd, p) !== 0x02014b50) throw new Error("El directorio del ZIP está dañado.");
    const flags = u16(cd, p + 8);
    const method = u16(cd, p + 10);
    const compSize = u32(cd, p + 20);
    const size = u32(cd, p + 24);
    const nameLen = u16(cd, p + 28);
    const extraLen = u16(cd, p + 30);
    const commentLen = u16(cd, p + 32);
    const localOffset = u32(cd, p + 42);
    // Bit 11: nombre en UTF-8; si no, Windows lo guardó con su página de códigos.
    const raw = cd.subarray(p + 46, p + 46 + nameLen);
    const path = (flags & 0x800 ? utf8 : legacy).decode(raw);
    p += 46 + nameLen + extraLen + commentLen;
    const name = path.split("/").pop() ?? path;
    if (path.endsWith("/") || path.startsWith("__MACOSX/") || name.startsWith("._") || name.startsWith("~$") || !name) continue;
    out.push({ path, name, method, compSize, size, localOffset });
  }
  return out;
}

/** Contenido de un archivo del ZIP. */
export async function readZipEntry(blob: Blob, e: ZipEntry): Promise<Uint8Array> {
  const head = await slice(blob, e.localOffset, e.localOffset + 30);
  if (u32(head, 0) !== 0x04034b50) throw new Error(`No pude leer "${e.name}" dentro del ZIP.`);
  const start = e.localOffset + 30 + u16(head, 26) + u16(head, 28);
  const data = blob.slice(start, start + e.compSize);
  if (e.method === 0) return new Uint8Array(await data.arrayBuffer());
  if (e.method !== 8) throw new Error(`"${e.name}" está comprimido con un método que no conozco. Vuelve a crear el ZIP con la opción normal de Windows.`);
  const out = await new Response(data.stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
  return new Uint8Array(out);
}

const KEYWORDS: [CampaignCode, RegExp][] = [
  ["cdc", /(^|[^a-z])cdc([^a-z]|$)|compra\s*de\s*cartera|cartera/],
  ["upin", /upin|upgrade|incremento/],
  ["seguros", /seguro/],
  ["domi", /domi/],
  ["extrafin", /extra/],
  ["tdc", /(^|[^a-z])(tdc|tc)([^a-z]|$)|tarjeta|primeras|segundas/],
];

/** Campaña según el nombre del archivo o, si no lo dice, de la carpeta donde está. */
export function guessCampaign(path: string): CampaignCode | null {
  const parts = path
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split("/")
    .reverse();
  for (const part of parts) for (const [code, re] of KEYWORDS) if (re.test(part)) return code;
  return null;
}

/** ¿Es un archivo de Excel o CSV que se puede leer? */
export const isSheetFile = (name: string) => /\.(xlsx|xlsb|xls|xlsm|csv)$/i.test(name);
