/* Marco limpio de las pantallas de entrada: tarjeta centrada sobre fondo azul muy claro. */
import type { ReactNode } from "react";

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#eef5ff] px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-[400px]">
        <div className="rounded-2xl border border-slate-200/80 bg-white px-6 py-7 shadow-[0_8px_30px_rgba(15,23,42,0.06)] sm:px-7 dark:border-slate-800 dark:bg-slate-900">
          <header className="mb-6 text-center">
            <p className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">CRM Talk Davivienda</p>
            <p className="mt-1 text-[11px] tracking-[0.08em] text-slate-500 uppercase">© {new Date().getFullYear()} Todos los derechos reservados.</p>
          </header>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h1>
          <p className="mt-0.5 mb-5 text-xs text-slate-500">{subtitle}</p>
          {children}
        </div>
        {footer && <div className="mt-4 text-center text-xs text-slate-500">{footer}</div>}
      </div>
    </div>
  );
}
