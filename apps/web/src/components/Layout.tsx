import { CAMPAIGNS } from "@crm/core";
import { useQuery } from "@tanstack/react-query";
import { FileText, LayoutDashboard, Menu, Moon, Search, Settings, Sparkles, Sun, Upload, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router";
import { api } from "../lib/api";
import { useTheme } from "../lib/theme";

const linkBase = "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors";
const linkClass = ({ isActive }: { isActive: boolean }) =>
  `${linkBase} ${
    isActive
      ? "bg-brand-50 font-medium text-brand-600 dark:bg-brand-500/15 dark:text-white"
      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
  }`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-6">
      <p className="mb-2 px-3 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Nav({ onNavigate }: { onNavigate: () => void }) {
  return (
    <nav aria-label="Principal" onClick={onNavigate}>
      <NavLink to="/" end className={linkClass}>
        <LayoutDashboard className="size-4" aria-hidden /> Panel Ejecutivo
      </NavLink>
      <Section title="Campañas">
        {CAMPAIGNS.map((c) => (
          <NavLink key={c.code} to={`/campanas/${c.code}`} className={linkClass}>
            <span className="flex size-4 items-center justify-center text-[10px] font-bold" aria-hidden>
              {c.shortName.slice(0, 2).toUpperCase()}
            </span>
            {c.shortName}
          </NavLink>
        ))}
      </Section>
      <Section title="Herramientas">
        <NavLink to="/cliente" className={linkClass}>
          <Search className="size-4" aria-hidden /> Cliente (NIU)
        </NavLink>
        <NavLink to="/carga" className={linkClass}>
          <Upload className="size-4" aria-hidden /> Centro de carga
        </NavLink>
        <NavLink to="/reportes" className={linkClass}>
          <FileText className="size-4" aria-hidden /> Reportes
        </NavLink>
        <NavLink to="/preguntar" className={linkClass}>
          <Sparkles className="size-4" aria-hidden /> Preguntar
        </NavLink>
        <NavLink to="/configuracion" className={linkClass}>
          <Settings className="size-4" aria-hidden /> Configuración
        </NavLink>
      </Section>
    </nav>
  );
}

const ROLE_LABEL = { admin: "Administrador", editor: "Editor", lector: "Solo lectura" } as const;

export function Layout() {
  const [open, setOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 5 * 60_000 });

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[256px_1fr]">
      {/* Menú lateral (en celular se abre como panel) */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto border-r border-slate-200 bg-white px-3 py-5 transition-transform dark:border-slate-800 dark:bg-slate-900 lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-6 flex items-center justify-between px-3">
          <div className="flex items-center gap-2.5">
            <img src="/favicon.svg" alt="" className="size-8" />
            <div className="leading-tight">
              <p className="text-sm font-semibold text-brand-900 dark:text-white">CRM Talk</p>
              <p className="text-xs text-slate-500">Davivienda</p>
            </div>
          </div>
          <button className="rounded-lg p-1.5 lg:hidden" onClick={() => setOpen(false)} aria-label="Cerrar menú">
            <X className="size-5" />
          </button>
        </div>
        <Nav onNavigate={() => setOpen(false)} />
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/80 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80 sm:px-6">
          <button className="rounded-lg p-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menú">
            <Menu className="size-5" />
          </button>
          <div className="flex-1" />
          <button
            onClick={toggle}
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label={theme === "oscuro" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
          >
            {theme === "oscuro" ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </button>
          {me.data && (
            <div className="text-right leading-tight">
              <p className="max-w-[40vw] truncate text-sm font-medium">{me.data.email}</p>
              <p className="text-xs text-slate-500">{ROLE_LABEL[me.data.role]}</p>
            </div>
          )}
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
