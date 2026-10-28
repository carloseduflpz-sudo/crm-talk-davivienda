/* Metas y cumplimientos oficiales: se sube el Excel "Cumplimientos de campaña Davivienda" (una hoja por año) y
   se guardan la meta y el resultado de cada campaña y mes. Las metas quedan en Metas (cumplimiento de cada mes) y los
   resultados se usan en el Histórico y en el gap trimestral de la presentación. */
import { CAMPAIGNS, GOAL_UNIT, getCampaign, leerCumplimientos, type CampaignCode, type Hoja, type MesOficial } from "@crm/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CircleCheck, CloudUpload, FileSpreadsheet, LoaderCircle } from "lucide-react";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router";
import { Button, ErrorMessage } from "../components/form";
import { Card, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { cargarSheetJS } from "../lib/sheetjs";
import { monthLabel } from "../lib/xlsx";

const fmtInt = new Intl.NumberFormat("es-SV", { maximumFractionDigits: 0 });
const fmtMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const fmtDate = (ms: number) => new Date(ms).toLocaleString("es-SV", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });

async function leerArchivo(file: File): Promise<{ meses: MesOficial[]; avisos: string[] }> {
  const XLSX = await cargarSheetJS();
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const hojas: Record<string, Hoja> = {};
  // Sin celdas vacías de relleno: una hoja con formato hasta la última columna no se vuelve enorme.
  for (const n of wb.SheetNames) hojas[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, blankrows: false });
  const r = leerCumplimientos(hojas);
  if (!r.meses.length) throw new Error('No encontré metas ni resultados. El archivo debe tener una hoja por año ("2025", "2026") y, por campaña, las filas Mes, Meta y Real.');
  return r;
}

export function Metas() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 5 * 60_000 });
  const puede = me.data?.permissions.includes("config:editar") ?? false;
  const guardado = useQuery({ queryKey: ["oficial"], queryFn: api.oficial });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [leido, setLeido] = useState<{ meses: MesOficial[]; avisos: string[] } | null>(null);
  const [estado, setEstado] = useState<"" | "leyendo" | "guardando" | "listo">("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const abrir = async (f: File) => {
    setError("");
    setLeido(null);
    setArchivo(f);
    setEstado("leyendo");
    try {
      setLeido(await leerArchivo(f));
      setEstado("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pude leer el archivo.");
      setEstado("");
    }
  };
  const guardar = async () => {
    if (!archivo || !leido) return;
    setError("");
    setEstado("guardando");
    try {
      await api.guardarOficial(archivo.name, leido.meses);
      setEstado("listo");
      await Promise.all([qc.invalidateQueries({ queryKey: ["oficial"] }), qc.invalidateQueries({ queryKey: ["historico"] })]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
      setEstado("");
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) void abrir(f);
  };

  // Lo que se muestra: lo recién leído (para revisarlo antes de guardar) o lo que ya está guardado.
  const meses = leido?.meses ?? guardado.data?.oficial?.meses ?? [];
  const metaApp = useMemo(() => new Map<string, number>((guardado.data?.metasApp ?? []).map((m) => [`${m.campaign}|${m.month}`, m.meta] as [string, number])), [guardado.data]);
  const porCampana = CAMPAIGNS.map((c) => ({ c, filas: meses.filter((m) => m.campaign === c.code) })).filter((x) => x.filas.length);
  const cambian = leido ? leido.meses.filter((m) => m.meta !== null && metaApp.has(`${m.campaign}|${m.month}`) && Math.abs(metaApp.get(`${m.campaign}|${m.month}`)! - m.meta) > 0.005).length : 0;
  const cifra = (c: CampaignCode, v: number | null) => (v === null ? "—" : GOAL_UNIT[c] === "monto" ? fmtMoney.format(v) : fmtInt.format(v));

  return (
    <>
      <PageHeader
        title="Metas y cumplimientos"
        subtitle="Tu Excel de cumplimientos de campaña: la meta y el resultado oficial de cada campaña y mes. Las metas quedan en Metas y los resultados se usan en el Histórico y en el gap trimestral de la presentación."
        actions={
          <Link to="/carga" className="inline-flex items-center gap-2 text-[13px] font-medium text-brand-600 hover:underline">
            <ArrowLeft className="size-4" aria-hidden /> Centro de carga
          </Link>
        }
      />

      {puede && (
        <Card className="mb-6">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => input.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
              dragging ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-slate-300 hover:border-brand-500/60 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/40"
            }`}
          >
            {estado === "leyendo" ? <LoaderCircle className="mb-3 size-9 animate-spin text-brand-500" aria-hidden /> : <FileSpreadsheet className="mb-3 size-9 text-brand-500" aria-hidden />}
            <p className="font-medium">{archivo ? archivo.name : "Arrastra aquí tu Excel de cumplimientos"}</p>
            <p className="mt-1 max-w-lg text-sm text-slate-500">Una hoja por año (2025, 2026…). En cada una, por campaña: su nombre, la fila de los meses y las filas Meta y Real.</p>
            <input
              ref={input}
              type="file"
              accept=".xlsx,.xls,.xlsb,.xlsm"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void abrir(f);
                e.target.value = "";
              }}
            />
          </div>
          {error && (
            <div className="mt-4">
              <ErrorMessage>{error}</ErrorMessage>
            </div>
          )}
          {leido && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <p className="text-sm text-ink-soft">
                {fmtInt.format(leido.meses.length)} meses leídos de {porCampana.length} campañas
                {cambian > 0 && ` · ${cambian} ${cambian === 1 ? "meta cambia" : "metas cambian"} respecto a lo que tiene la app`}.
              </p>
              {estado === "listo" ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                  <CircleCheck className="size-4" aria-hidden /> Guardado
                </span>
              ) : (
                <Button onClick={guardar} loading={estado === "guardando"}>
                  <CloudUpload className="size-4" aria-hidden /> Guardar metas y resultados
                </Button>
              )}
              {leido.avisos.map((a) => (
                <p key={a} className="w-full text-sm text-amber-700 dark:text-amber-300">
                  {a}
                </p>
              ))}
            </div>
          )}
        </Card>
      )}

      {!leido && guardado.data?.oficial && (
        <p className="mb-4 text-sm text-ink-soft">
          Guardado: <span className="font-medium text-ink">{guardado.data.oficial.archivo}</span>, por {guardado.data.oficial.por} el {fmtDate(guardado.data.oficial.fecha)}.
        </p>
      )}
      {!leido && !guardado.isPending && !guardado.data?.oficial && <p className="text-sm text-ink-soft">Todavía no se ha subido el archivo de cumplimientos.</p>}

      <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        {porCampana.map(({ c, filas }) => (
          <Card key={c.code} className="p-0">
            <h2 className="border-b border-hair px-5 py-3 text-[15px] font-semibold text-ink">{getCampaign(c.code).name}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-ink-soft">
                    <th className="px-5 py-2 font-medium">Mes</th>
                    <th className="px-3 py-2 text-right font-medium">Meta</th>
                    <th className="px-3 py-2 text-right font-medium">Real</th>
                    <th className="px-5 py-2 text-right font-medium">Cumplimiento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hair">
                  {[...filas].reverse().map((m) => {
                    const app = metaApp.get(`${m.campaign}|${m.month}`);
                    const distinta = leido && m.meta !== null && app !== undefined && Math.abs(app - m.meta) > 0.005;
                    return (
                      <tr key={m.month}>
                        <td className="px-5 py-1.5 text-ink first-letter:uppercase">{monthLabel(m.month)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {cifra(c.code, m.meta)}
                          {distinta && <span className="block text-[11px] text-amber-700 dark:text-amber-300">en la app: {cifra(c.code, app!)}</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{cifra(c.code, m.real)}</td>
                        <td className="px-5 py-1.5 text-right tabular-nums">{m.meta && m.real !== null ? `${Math.round((m.real / m.meta) * 100)}%` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
