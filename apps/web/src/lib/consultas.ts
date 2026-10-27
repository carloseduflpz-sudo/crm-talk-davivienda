/* Consultas compartidas entre pantallas y la precarga de campañas: misma clave = mismo dato en memoria. */
import { CAMPAIGNS, type CampaignAnalysis } from "@crm/core";
import type { QueryClient } from "@tanstack/react-query";
import { api } from "./api";

/** Un análisis se reutiliza 2 minutos sin volver a pedirlo (cualquier cambio que se guarde lo renueva al momento). */
export const FRESCO = 2 * 60_000;

export const consultaAnalisis = (code: string, mes: string | null = null, agente: string | null = null) => ({
  queryKey: ["analysis", code, mes, agente] as const,
  queryFn: () => api.analysis(code, mes, agente),
  staleTime: FRESCO,
});

/** Mes anterior al que se muestra (para las comparaciones), o undefined si no hay. */
export const mesAnterior = (a: CampaignAnalysis | undefined) => (a?.month ? a.months[a.months.indexOf(a.month) + 1] : undefined);

/** Deja listo lo que pide la pantalla de una campaña al abrirla: el último mes y el anterior. */
export async function precargarCampana(qc: QueryClient, code: string): Promise<void> {
  try {
    const a = await qc.fetchQuery(consultaAnalisis(code));
    const prev = mesAnterior(a);
    if (prev) await qc.prefetchQuery(consultaAnalisis(code, prev));
  } catch {
    // Precargar es opcional: si falla, la pantalla lo pide al abrirse y muestra el error ahí.
  }
}

/** En segundo plano, una campaña a la vez (la base de datos atiende una consulta a la vez: así no estorba). */
export async function precargarTodas(qc: QueryClient, seguir: () => boolean, primero?: string): Promise<void> {
  const orden = [...CAMPAIGNS.map((c) => c.code)].sort((x, y) => Number(y === primero) - Number(x === primero));
  for (const code of orden) {
    if (!seguir()) return;
    await precargarCampana(qc, code);
  }
}
