/* Filtro por agente: un botón que abre una lista con búsqueda. Con un agente elegido, toda la
   vista de la campaña se recalcula solo para esa persona. */
import { Check, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function AgentPicker({
  agents,
  value,
  onChange,
  merged = [],
}: {
  agents: string[];
  value: string | null;
  onChange: (a: string | null) => void;
  /** Agentes cuyo nombre viene escrito de varias formas y la herramienta unió sola. */
  merged?: { nombre: string; variantes: string[] }[];
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // Otras formas en que viene escrito cada agente (sin repetir el nombre que se muestra).
  const aka = useMemo(() => new Map(merged.map((g) => [g.nombre, g.variantes.filter((v) => v !== g.nombre)])), [merged]);
  const list = useMemo(() => {
    const k = norm(q.trim());
    return agents.filter((a) => !k || norm(a).includes(k) || (aka.get(a) ?? []).some((v) => norm(v).includes(k)));
  }, [agents, q, aka]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const pick = (a: string | null) => {
    onChange(a);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => {
            if (!open) {
              setQ("");
              setCursor(value ? agents.indexOf(value) + 1 : 0);
            }
            setOpen((v) => !v);
          }}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={`inline-flex items-center gap-2 rounded-full border py-1.5 pr-3 pl-3.5 text-[13px] transition-colors ${
            value ? "border-brand-500/40 bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-100" : "border-hair bg-white text-ink-soft hover:text-ink dark:bg-slate-900"
          } ${value ? "rounded-r-none border-r-0 pr-2.5" : ""}`}
        >
          <span className="max-w-48 truncate">{value ?? "Todos los agentes"}</span>
          <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="inline-flex items-center rounded-r-full border border-l-0 border-brand-500/40 bg-brand-50 py-1.5 pr-2.5 pl-1.5 text-brand-600 hover:text-brand-900 dark:bg-brand-500/15 dark:text-brand-100"
            aria-label="Quitar el filtro de agente"
            title="Ver todos los agentes"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      {open && (
        <div className="fade-in absolute top-full left-0 z-40 mt-2 w-72 overflow-hidden rounded-2xl border border-hair bg-white shadow-[0_16px_40px_rgba(14,27,61,0.12)] dark:bg-slate-900">
          <label className="relative block border-b border-hair">
            <span className="sr-only">Buscar agente</span>
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <input
              ref={input}
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setCursor(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") (e.preventDefault(), setCursor((c) => Math.min(c + 1, list.length)));
                else if (e.key === "ArrowUp") (e.preventDefault(), setCursor((c) => Math.max(c - 1, 0)));
                else if (e.key === "Enter") (e.preventDefault(), pick(cursor === 0 ? null : (list[cursor - 1] ?? null)));
                else if (e.key === "Escape") setOpen(false);
              }}
              placeholder="Buscar agente"
              className="w-full bg-transparent py-3 pr-3 pl-10 text-[13.5px] text-ink outline-none placeholder:text-ink-faint"
              role="combobox"
              aria-controls="lista-agentes"
              aria-expanded
            />
          </label>
          <ul id="lista-agentes" role="listbox" className="max-h-72 overflow-y-auto py-1.5">
            {[null, ...list].map((a, i) => {
              const selected = a === value;
              return (
                <li key={a ?? "__todos"} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => pick(a)}
                    onPointerEnter={() => setCursor(i)}
                    className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-[13.5px] ${i === cursor ? "bg-paper dark:bg-slate-800" : ""} ${a === null ? "text-ink-soft" : "text-ink"}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{a ?? "Todos los agentes"}</span>
                      {a && !!aka.get(a)?.length && (
                        <span className="block truncate text-[11.5px] text-ink-faint" title={aka.get(a)!.join(" · ")}>
                          También como {aka.get(a)!.join(", ")}
                        </span>
                      )}
                    </span>
                    {selected && <Check className="size-4 shrink-0 text-brand-600" aria-hidden />}
                  </button>
                </li>
              );
            })}
            {list.length === 0 && <li className="px-4 py-2 text-[13px] text-ink-faint">Ningún agente coincide.</li>}
          </ul>
          {merged.length > 0 && (
            <p className="border-t border-hair px-4 py-2.5 text-[12px] leading-snug text-ink-faint">
              {merged.length === 1 ? "1 agente venía" : `${merged.length} agentes venían`} escrito de varias formas en los archivos; se unieron solos.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
