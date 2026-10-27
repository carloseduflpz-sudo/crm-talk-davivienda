/* Resultados ya calculados (análisis de cada campaña y cifras de la presentación), guardados en R2.

   Calcular una campaña son decenas de consultas sobre miles de filas; mostrar algo ya calculado es leer un archivo.
   Para que nunca se vea una cifra vieja:
   - Cada escritura de la app (cargar, confirmar, quitar o activar archivos, metas, nombres de agentes, Excel de
     las gráficas…) cambia la "revisión" general (ver http.ts).
   - Un resultado guardado solo se usa si se calculó con la revisión vigente y con el mismo código publicado.
   Si R2 falla, se calcula como siempre: lo guardado es un atajo, nunca la fuente de las cifras. */
import type { Env } from "./env";

const REVISION = "cache/revision";
const PREFIJO = "cache/resultados/";

/** Código publicado: con cada publicación nueva se recalcula todo. */
const publicacion = (env: Env) => env.CF_VERSION_METADATA?.id ?? "local";

async function leerRevision(env: Env): Promise<string> {
  const obj = await env.FILES.get(REVISION);
  return obj ? await obj.text() : "inicial";
}

/** Se llama después de cada escritura: lo guardado hasta ahora deja de valer. */
export async function marcarCambio(env: Env): Promise<void> {
  try {
    await env.FILES.put(REVISION, `${Date.now()}-${crypto.randomUUID()}`);
  } catch (err) {
    console.error("No se pudo marcar el cambio de revisión", err);
  }
}

/** Una por petición: la revisión se lee una sola vez aunque la petición pida varios resultados. */
export class Resultados {
  private rev: Promise<string | null> | null = null;
  constructor(private readonly env: Env) {}

  private revision(): Promise<string | null> {
    // null = R2 no disponible: se calcula sin guardar.
    return (this.rev ??= leerRevision(this.env).catch(() => null));
  }

  async obtener<T>(clave: string, calcular: () => Promise<T>): Promise<T> {
    const key = PREFIJO + clave;
    const build = publicacion(this.env);
    const [rev, guardado] = await Promise.all([this.revision(), Promise.resolve().then(() => this.env.FILES.get(key)).catch(() => null)]);
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
