/* Cliente: busca por NIU (uno o varios, pegados de Excel, un correo, un chat...), por nombre o por teléfono, y
   muestra todo lo del cliente para darle seguimiento. La ficha se arma con los archivos vigentes: al cargar una
   sábana nueva, ya muestra lo último. Todo el seguimiento se puede descargar en Excel. */
import { getCampaign, isCampaignCode, type CampaignCode } from "@crm/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useState, type ClipboardEvent, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { ClientCard } from "../components/ClientCard";
import { PageHeader } from "../components/ui";
import { api, type ClientFile } from "../lib/api";
import { descargarSeguimiento } from "../lib/seguimiento";

/** Todos los NIU de un texto pegado o escrito (separados por espacios, saltos de línea, comas…), sin puntos ni
    guiones y sin ceros a la izquierda, como se guardan. Sirve para pegar una columna de Excel. */
export function nius(text: string): string[] {
  const out: string[] = [];
  for (const token of text.split(/[\s,;|/]+/)) {
    for (const m of token.match(/\d[\d.-]*\d|\d/g) ?? []) {
      const n = m.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
      if (n.length >= 3 && n.length <= 30 && !out.includes(n)) out.push(n);
    }
  }
  return out.slice(0, 50);
}

/** ¿Lo escrito es un nombre (trae letras)? Un teléfono escrito "7406-5924" o "(503) 7406 5924" no lo es. */
const esNombre = (s: string) => /[a-záéíóúñü]/i.test(s);
/** Un solo número que puede ser teléfono (8 dígitos, o con el 503 adelante) o NIU: se busca de las dos formas. */
const unSoloNumero = (s: string) => nius(s).length === 1 && !/[\n,;]/.test(s.trim()) && s.replace(/\D/g, "").length >= 7;

const campana = (c: string) => (isCampaignCode(c) ? getCampaign(c as CampaignCode).shortName : c);
const POR = { niu: "NIU", telefono: "Teléfono", nombre: "Nombre" } as const;

export function Client() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const list = (params.get("niu") ?? "").split(",").filter(Boolean);
  const current = params.get("ver") && list.includes(params.get("ver")!) ? params.get("ver")! : list[0];
  const [text, setText] = useState(q || list.join(" "));
  const [error, setError] = useState("");
  const [bajando, setBajando] = useState("");
  // Con un cliente abierto, la lista de resultados se recoge (para que la ficha quede a la vista).
  const [verLista, setVerLista] = useState(false);
  useEffect(() => setVerLista(false), [current]);

  // Búsqueda por nombre o teléfono (o un número que puede ser NIU o teléfono).
  const busqueda = useQuery({ queryKey: ["buscar", q], queryFn: () => api.buscarClientes(q), enabled: Boolean(q), staleTime: 60_000 });
  const resultados = busqueda.data?.resultados ?? [];
  // Un solo resultado se abre de una vez; un número que no aparece como teléfono se consulta como NIU.
  useEffect(() => {
    if (!q || list.length || !busqueda.data) return;
    if (resultados.length === 1) setParams({ q, niu: resultados[0]!.niu }, { replace: true });
    else if (!resultados.length && !esNombre(q)) setParams({ q, niu: nius(q)[0] ?? q }, { replace: true });
  }, [busqueda.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (esNombre(t) || unSoloNumero(t)) {
      setError("");
      setText(t);
      setParams({ q: t });
      return;
    }
    const found = nius(t);
    if (!found.length) {
      setError("No encontré ningún NIU, nombre o teléfono en lo que escribiste.");
      return;
    }
    setError("");
    setText(found.join(" "));
    setParams({ niu: found.join(",") });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    go(text);
  };
  // Al pegar se consulta de una vez, sin tener que dar clic en Buscar.
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (!pasted) return;
    e.preventDefault();
    go(pasted);
  };

  /** Descarga la ficha de esos NIU (una hoja por tema). */
  const descargar = async (cuales: string[], nombre: string) => {
    setBajando(nombre);
    setError("");
    try {
      const fichas: ClientFile[] = [];
      for (const n of cuales) fichas.push(await qc.fetchQuery({ queryKey: ["cliente", n, null], queryFn: () => api.client(n), staleTime: 60_000 }));
      await descargarSeguimiento(fichas, nombre);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo preparar la descarga.");
    } finally {
      setBajando("");
    }
  };

  // Los que se pueden descargar juntos: los NIU pegados o los resultados de la búsqueda.
  const todos = list.length > 1 ? list : resultados.length > 1 ? resultados.map((r) => r.niu) : [];
  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Cliente" subtitle="Busca por NIU, nombre o teléfono y ve todo lo del cliente para darle seguimiento: contacto, ventas, bases, llamadas y CRM." />
      <form onSubmit={submit} className="mb-6 flex max-w-2xl flex-wrap items-start gap-3">
        <label className="relative min-w-60 flex-1">
          <span className="sr-only">NIU, nombre o teléfono del cliente</span>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={onPaste}
            autoFocus
            placeholder="NIU (o varios), nombre o teléfono"
            aria-invalid={Boolean(error)}
            className="w-full rounded-full border border-hair bg-white py-2.5 pr-10 pl-10 text-[14px] text-ink outline-none placeholder:text-ink-faint focus:border-brand-500 dark:bg-slate-900"
          />
          {text && (
            <button
              type="button"
              onClick={() => {
                setText("");
                setError("");
                setParams({});
              }}
              className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-1 text-ink-faint hover:text-ink"
              aria-label="Borrar"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </label>
        <button type="submit" className="rounded-full bg-brand-500 px-5 py-2.5 text-[14px] font-medium text-white hover:bg-brand-600">
          Buscar
        </button>
        {error && <p className="w-full text-[13px] text-[var(--st-critical)]">{error}</p>}
      </form>

      {q && busqueda.isPending && (
        <p className="mb-6 inline-flex items-center gap-2 text-sm text-ink-soft">
          <LoaderCircle className="size-4 animate-spin" aria-hidden /> Buscando {esNombre(q) ? "por nombre" : "por teléfono y NIU"}…
        </p>
      )}
      {q && busqueda.isError && <p className="mb-6 text-sm text-[var(--st-critical)]">{busqueda.error.message}</p>}
      {q && busqueda.data && !resultados.length && esNombre(q) && <p className="mb-6 text-sm text-ink-soft">Nadie en los archivos vigentes se llama así. Prueba con un solo apellido o con el NIU.</p>}

      {resultados.length > 1 && current && !verLista && (
        <p className="mb-6 text-[13px] text-ink-soft">
          Cliente {resultados.findIndex((r) => r.niu === current) + 1} de {resultados.length === 50 ? "más de 50" : resultados.length} con {esNombre(q) ? "ese nombre" : "ese número"} ·{" "}
          <button onClick={() => setVerLista(true)} className="font-medium text-brand-600 hover:underline">
            ver la lista
          </button>
        </p>
      )}
      {resultados.length > 1 && (!current || verLista) && (
        <div className="mb-8 max-w-4xl">
          <p className="mb-2 text-[13px] text-ink-soft">
            {resultados.length === 50 ? "Más de 50 clientes" : `${resultados.length} clientes`} con {esNombre(q) ? "ese nombre" : "ese número"}
            {resultados.length === 50 && ": escribe el nombre más completo para acotar"}.
          </p>
          <ul className="divide-y divide-hair overflow-hidden rounded-2xl border border-hair bg-white dark:bg-slate-900">
            {resultados.map((r) => (
              <li key={r.niu}>
                <button
                  onClick={() => setParams({ q, niu: r.niu })}
                  aria-current={r.niu === current}
                  className={`flex w-full flex-wrap items-baseline gap-x-4 gap-y-0.5 px-4 py-2.5 text-left text-[13px] transition-colors hover:bg-paper dark:hover:bg-slate-800 ${r.niu === current ? "bg-brand-50 dark:bg-brand-500/10" : ""}`}
                >
                  <span className="min-w-48 flex-1 font-medium text-ink">{r.nombre ?? "Sin nombre en los archivos"}</span>
                  <span className="text-ink-soft tabular-nums">NIU {r.niu}</span>
                  {r.telefono && <span className="text-ink-soft tabular-nums">{r.telefono}</span>}
                  <span className="text-ink-faint">{r.campanas.map(campana).join(", ")}</span>
                  {!esNombre(q) && <span className="text-[11.5px] text-ink-faint">por {POR[r.por].toLowerCase()}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {list.length > 1 && (
        <div className="mb-8 flex flex-wrap items-center gap-2" role="tablist" aria-label="NIU consultados">
          <span className="mr-1 text-[13px] text-ink-soft">{list.length} NIU:</span>
          {list.map((n) => (
            <button
              key={n}
              role="tab"
              aria-selected={n === current}
              onClick={() => setParams({ niu: list.join(","), ver: n })}
              className={`rounded-full px-3 py-1 text-[13px] tabular-nums transition-colors ${
                n === current ? "bg-ink text-white dark:bg-white dark:text-slate-900" : "bg-white text-ink-soft ring-1 ring-hair hover:text-ink dark:bg-slate-900"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      )}

      {(current || todos.length > 0) && (
        <div className="mb-6 flex flex-wrap gap-2">
          {current && (
            <button
              onClick={() => void descargar([current], `Seguimiento ${current} ${hoy}.xlsx`)}
              disabled={Boolean(bajando)}
              className="inline-flex items-center gap-2 rounded-full border border-hair bg-white px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:border-brand-500 disabled:opacity-60 dark:bg-slate-900"
            >
              {bajando.includes(current) ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Download className="size-4 text-ink-soft" aria-hidden />} Descargar seguimiento (Excel)
            </button>
          )}
          {todos.length > 1 && (
            <button
              onClick={() => void descargar(todos, `Seguimiento ${todos.length} clientes ${hoy}.xlsx`)}
              disabled={Boolean(bajando)}
              className="inline-flex items-center gap-2 rounded-full border border-hair bg-white px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:border-brand-500 disabled:opacity-60 dark:bg-slate-900"
            >
              {bajando.includes("clientes") ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Download className="size-4 text-ink-soft" aria-hidden />} Descargar los {todos.length} clientes
            </button>
          )}
        </div>
      )}

      {current ? (
        <div className="max-w-4xl">
          <ClientCard key={current} niu={current} />
        </div>
      ) : (
        !q && (
          <p className="text-sm text-ink-soft">
            Escribe el nombre (o solo un apellido), el teléfono o el NIU tal como lo tengas: con espacios, guiones o ceros adelante. También puedes pegar una columna de Excel con varios NIU.
          </p>
        )
      )}
    </>
  );
}
