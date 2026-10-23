/* Cliente (NIU): pega uno o varios NIU (de Excel, un correo, un chat...) y se consulta al instante.
   La ficha se arma con los archivos vigentes: al cargar una sábana nueva, ya muestra lo último. */
import { Search, X } from "lucide-react";
import { useState, type ClipboardEvent, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { ClientCard } from "../components/ClientCard";
import { PageHeader } from "../components/ui";

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

export function Client() {
  const [params, setParams] = useSearchParams();
  const list = (params.get("niu") ?? "").split(",").filter(Boolean);
  const current = params.get("ver") && list.includes(params.get("ver")!) ? params.get("ver")! : list[0];
  const [text, setText] = useState(list.join(" "));
  const [error, setError] = useState("");

  const go = (raw: string) => {
    const found = nius(raw);
    if (!found.length) {
      setError("No encontré ningún NIU en lo que escribiste. Pega o escribe el número del cliente.");
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

  return (
    <>
      <PageHeader title="Cliente (NIU)" subtitle="Pega uno o varios NIU y ve todo lo del cliente para darle seguimiento: contacto, ventas, bases, llamadas y CRM." />
      <form onSubmit={submit} className="mb-6 flex max-w-2xl flex-wrap items-start gap-3">
        <label className="relative min-w-60 flex-1">
          <span className="sr-only">NIU del cliente</span>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={onPaste}
            autoFocus
            placeholder="Pega aquí el NIU (o varios)"
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

      {current ? (
        <div className="max-w-4xl">
          <ClientCard key={current} niu={current} />
        </div>
      ) : (
        <p className="text-sm text-ink-soft">Pega el NIU tal como lo tengas (con espacios, guiones o ceros adelante) y se consulta solo. También puedes pegar una columna de Excel con varios.</p>
      )}
    </>
  );
}
