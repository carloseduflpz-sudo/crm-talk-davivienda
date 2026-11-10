/* Resultados ya calculados (análisis de cada campaña y cifras de la presentación), guardados en R2.

   Calcular una campaña son decenas de consultas sobre miles de filas; mostrar algo ya calculado es leer un archivo.
   Para que nunca se vea una cifra vieja:
   - Cada escritura de la app cambia una "revisión" (ver http.ts): la de su campaña si solo toca una (cargar,
     confirmar, quitar o activar un archivo, la meta de un mes) o la general si puede tocar varias (Excel de
     cumplimientos, plantilla y control de la presentación, usuarios…).
   - Un resultado de una campaña solo se usa si se calculó con la revisión general y la de esa campaña vigentes y
     con el mismo código publicado. Así, cargar un archivo de TC ya no obliga a recalcular las otras 5 campañas
     (recalcular todo a la vez satura la base de datos de Cloudflare).
   Si R2 falla, se calcula como siempre: lo guardado es un atajo, nunca la fuente de las cifras. */
import type { Env } from "./env";

const REVISION = "cache/revision";
const revisionDe = (campana: string | null) => (campana ? `${REVISION}/${campana}` : REVISION);
const PREFIJO = "cache/resultados/";

/** Código publicado: con cada publicación nueva se recalcula todo. */
const publicacion = (env: Env) => env.CF_VERSION_METADATA?.id ?? "local";

async function leerRevision(env: Env, campana: string | null): Promise<string> {
  const obj = await env.FILES.get(revisionDe(campana));
  return obj ? await obj.text() : "inicial";
}

/** Se llama después de cada escritura: lo guardado hasta ahora (de esa campaña, o de todas) deja de valer. */
export async function marcarCambio(env: Env, campana: string | null = null): Promise<void> {
  try {
    await env.FILES.put(revisionDe(campana), `${Date.now()}-${crypto.randomUUID()}`);
  } catch (err) {
    console.error("No se pudo marcar el cambio de revisión", err);
  }
}

/** Una por petición: la revisión se lee una sola vez aunque la petición pida varios resultados. */
export class Resultados {
  private revs = new Map<string, Promise<string | null>>();
  constructor(private readonly env: Env) {}

  private leer(campana: string | null): Promise<string | null> {
    const k = campana ?? "";
    // null = R2 no disponible: se calcula sin guardar.
    if (!this.revs.has(k)) this.revs.set(k, leerRevision(this.env, campana).catch(() => null));
    return this.revs.get(k)!;
  }

  /** Revisión con la que vale un resultado: la general más la de su campaña. */
  private async revision(campana: string | null): Promise<string | null> {
    const [general, propia] = await Promise.all([this.leer(null), campana ? this.leer(campana) : Promise.resolve("")]);
    return general === null || propia === null ? null : `${general}|${propia}`;
  }

  /** campana: de qué campaña depende el resultado (null = de cualquier escritura). */
  async obtener<T>(clave: string, calcular: () => Promise<T>, campana: string | null = null): Promise<T> {
    const key = PREFIJO + clave;
    const build = publicacion(this.env);
    const [rev, guardado] = await Promise.all([this.revision(campana), Promise.resolve().then(() => this.env.FILES.get(key)).catch(() => null)]);
    if (guardado) {
      const meta = guardado.customMetadata ?? {};
      if (rev !== null && meta.rev === rev && meta.build === build) {
        try {
          return await guardado.json<T>();
        } catch {
          // archivo dañado: se recalcula
        }
      } else {
        await guardado.body?.cancel().catch(() => {});
      }
    }
    const valor = await calcular();
    // Se guarda con la revisión leída ANTES de calcular: si algo cambió mientras tanto, no se volverá a usar.
    if (rev !== null) {
      await this.env.FILES.put(key, JSON.stringify(valor), {
        httpMetadata: { contentType: "application/json" },
        customMetadata: { rev, build },
      }).catch((err: unknown) => console.error("No se pudo guardar el resultado", key, err));
    }
    return valor;
  }
}

/** Parte de una clave a partir de un texto libre (nombre de agente). */
export const parteClave = (v: string | null) => (v === null ? "-" : encodeURIComponent(v));
