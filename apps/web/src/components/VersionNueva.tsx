import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

/** Archivo principal (con su huella) que cargó esta pestaña. */
function scriptActual(): string | null {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  return s ? new URL(s.src, location.href).pathname : null;
}

/**
 * Avisa cuando se publicó una versión nueva del CRM mientras la pestaña seguía abierta: una pestaña vieja
 * sigue usando el código anterior (cifras con las reglas de antes, lector de Excel que ya no existe).
 * Revisa al volver a la pestaña y cada 5 minutos.
 */
export function VersionNueva() {
  const [nueva, setNueva] = useState(false);
  useEffect(() => {
    const actual = scriptActual();
    if (!actual) return; // en desarrollo no hay archivos con huella
    let activo = true;
    const revisar = async () => {
      if (document.hidden || !activo) return;
      try {
        const html = await (await fetch("/", { cache: "no-store", credentials: "same-origin" })).text();
        const m = /<script[^>]+type="module"[^>]+src="([^"]*\/assets\/[^"]+)"/.exec(html);
        if (m && new URL(m[1]!, location.href).pathname !== actual && activo) setNueva(true);
      } catch {
        /* sin conexión: se vuelve a intentar después */
      }
    };
    const cada = window.setInterval(revisar, 5 * 60_000);
    document.addEventListener("visibilitychange", revisar);
    window.addEventListener("focus", revisar);
    void revisar();
    return () => {
      activo = false;
      window.clearInterval(cada);
      document.removeEventListener("visibilitychange", revisar);
      window.removeEventListener("focus", revisar);
    };
  }, []);
  if (!nueva) return null;
  return (
    <div role="status" className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-3 bg-brand-600 px-4 py-2.5 text-[13.5px] text-white">
      <span>Hay una versión nueva del CRM. Actualiza para ver las cifras y las cargas con los últimos cambios.</span>
      <button
        type="button"
        onClick={() => location.reload()}
        className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 font-medium hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-white"
      >
        <RefreshCw className="size-3.5" aria-hidden /> Actualizar
      </button>
    </div>
  );
}
