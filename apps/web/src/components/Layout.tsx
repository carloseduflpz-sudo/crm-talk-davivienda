import { CAMPAIGNS } from "@crm/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, KeyRound, LayoutDashboard, LogOut, Menu, Moon, Pin, PinOff, Presentation, Search, Settings, Sparkles, Sun, Upload, Users, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { api, type Me } from "../lib/api";
import { precargarCampana, precargarTodas } from "../lib/consultas";
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
  const qc = useQueryClient();
  return (
    <nav aria-label="Principal" onClick={onNavigate}>
      <NavLink to="/" end className={linkClass}>
        <LayoutDashboard className="size-4" aria-hidden /> Panel Ejecutivo
      </NavLink>
      <Section title="Campañas">
        {CAMPAIGNS.map((c) => (
          // Al pasar el mouse ya se piden sus cifras: al dar clic suelen estar listas.
          <NavLink key={c.code} to={`/campanas/${c.code}`} className={linkClass} onMouseEnter={() => void precargarCampana(qc, c.code)} onFocus={() => void precargarCampana(qc, c.code)}>
            <span className="flex size-4 items-center justify-center text-[10px] font-bold" aria-hidden>
              {c.shortName.slice(0, 2).toUpperCase()}
            </span>
            {c.shortName}
          </NavLink>
        ))}
      </Section>
      <Section title="Herramientas">
        <NavLink to="/cliente" className={linkClass}>
          <Search className="size-4" aria-hidden /> Buscar cliente
        </NavLink>
        <NavLink to="/carga" className={linkClass}>
          <Upload className="size-4" aria-hidden /> Centro de carga
        </NavLink>
        <NavLink to="/presentacion" className={linkClass}>
          <Presentation className="size-4" aria-hidden /> Presentación
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

function AccountMenu({ me }: { me: Me }) {
  const [busy, setBusy] = useState(false);
  const initials = me.displayName
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const logout = async () => {
    setBusy(true);
    try {
      await api.logout();
    } finally {
      location.assign("/");
    }
  };
  const item = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800";
  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 [&::-webkit-details-marker]:hidden">
        <span className="flex size-8 items-center justify-center rounded-full bg-brand-500 text-xs font-semibold text-white" aria-hidden>
          {initials}
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block max-w-[30vw] truncate text-sm font-medium">{me.displayName}</span>
          <span className="block text-xs text-slate-500">{ROLE_LABEL[me.role]}</span>
        </span>
        <ChevronDown className="size-4 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div
        className="absolute right-0 z-50 mt-2 w-60 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute("open")}
      >
        <p className="px-3 pt-2 pb-1 text-xs text-slate-500">
          Usuario: <span className="font-medium text-slate-700 dark:text-slate-300">{me.username}</span>
        </p>
        <Link to="/cuenta/clave" className={item}>
          <KeyRound className="size-4" aria-hidden /> Cambiar contraseña
        </Link>
        {me.permissions.includes("usuarios:administrar") && (
          <Link to="/configuracion/usuarios" className={item}>
            <Users className="size-4" aria-hidden /> Usuarios
          </Link>
        )}
        <button onClick={logout} disabled={busy} className={`${item} text-red-600`}>
          <LogOut className="size-4" aria-hidden /> {busy ? "Cerrando sesión…" : "Cerrar sesión"}
        </button>
      </div>
    </details>
  );
}

const PIN_KEY = "crm:menu-fijo";
const readPin = () => {
  try {
    return localStorage.getItem(PIN_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * Pantalla completa para la información: el menú se esconde y aparece al acercar el mouse al
 * borde izquierdo (o con el botón de menú, en celular o con teclado). Se puede fijar.
 */
export function Layout() {
  const [pinned, setPinned] = useState(readPin);
  const [open, setOpen] = useState<null | "hover" | "click">(null);
  const timer = useRef<number | undefined>(undefined);
  const { theme, toggle } = useTheme();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 5 * 60_000 });
  const qc = useQueryClient();
  const { pathname } = useLocation();
  const puedeVer = me.data?.permissions.includes("datos:ver") ?? false;

  /* Al abrir la app se dejan listas, en segundo plano, las cifras de las 6 campañas (primero la que está en
     pantalla): cambiar de campaña ya no espera al cálculo. Se repite cada pocos minutos mientras siga abierta. */
  const actual = /^\/campanas\/([^/]+)/.exec(pathname)?.[1];
  const actualRef = useRef(actual);
  actualRef.current = actual;
  useEffect(() => {
    if (!puedeVer) return;
    let activo = true;
    let corriendo = false;
    const ronda = async () => {
      if (corriendo || document.hidden) return;
      corriendo = true;
      await precargarTodas(qc, () => activo, actualRef.current);
      corriendo = false;
    };
    const inicio = window.setTimeout(ronda, 800);
    const cada = window.setInterval(ronda, 3 * 60_000);
    return () => {
      activo = false;
      window.clearTimeout(inicio);
      window.clearInterval(cada);
    };
  }, [qc, puedeVer]);

  const later = (fn: () => void, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, ms);
  };
  const opening = useRef(false);
  // Solo con movimiento real del mouse (no si la página carga con el cursor ya en el borde).
  const showOnHover = () => {
    if (opening.current) return;
    opening.current = true;
    later(() => {
      opening.current = false;
      setOpen((o) => o ?? "hover");
    }, 90);
  };
  const hideAfterHover = () => {
    opening.current = false;
    later(() => setOpen((o) => (o === "hover" ? null : o)), 280);
  };
  const close = () => {
    window.clearTimeout(timer.current);
    setOpen(null);
  };
  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    setOpen(null);
    try {
      localStorage.setItem(PIN_KEY, next ? "1" : "0");
    } catch {
      /* sin almacenamiento: queda solo para esta visita */
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const slide = open ? "translate-x-0" : pinned ? "-translate-x-full lg:translate-x-0" : "-translate-x-full";
  const floating = open && !(pinned && window.matchMedia?.("(min-width: 1024px)").matches);

  return (
    <div className={`min-h-dvh ${pinned ? "lg:pl-64" : ""}`}>
      {/* Zona invisible en el borde izquierdo: al acercar el mouse aparece el menú. */}
      {!pinned && (
        <>
          <div className="fixed inset-y-0 left-0 z-30 hidden w-3 lg:block" onMouseMove={showOnHover} onMouseLeave={hideAfterHover} aria-hidden />
          <span className={`pointer-events-none fixed top-1/2 left-1 z-30 hidden h-14 w-1 -translate-y-1/2 rounded-full bg-ink-faint/40 transition-opacity lg:block ${open ? "opacity-0" : "opacity-100"}`} aria-hidden />
        </>
      )}

      <aside
        onMouseEnter={() => open === "hover" && window.clearTimeout(timer.current)}
        onMouseLeave={() => open === "hover" && hideAfterHover()}
        aria-hidden={!open && !pinned}
        className={`fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto border-r border-hair bg-white px-3 py-5 transition-transform duration-200 ease-out dark:bg-slate-900 ${slide} ${
          floating ? "shadow-[12px_0_40px_rgba(14,27,61,0.12)]" : ""
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
          <div className="flex items-center gap-0.5">
            <button
              className="hidden rounded-lg p-1.5 text-ink-soft hover:bg-paper hover:text-ink lg:block dark:hover:bg-slate-800"
              onClick={togglePin}
              aria-pressed={pinned}
              title={pinned ? "Soltar el menú: se esconde y aparece al acercar el mouse a la izquierda" : "Fijar el menú a la izquierda"}
              aria-label={pinned ? "Soltar el menú" : "Fijar el menú"}
            >
              {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
            </button>
            {(open || !pinned) && (
              <button className="rounded-lg p-1.5 text-ink-soft hover:bg-paper hover:text-ink dark:hover:bg-slate-800" onClick={close} aria-label="Cerrar menú">
                <X className="size-5" />
              </button>
            )}
          </div>
        </div>
        <Nav onNavigate={() => !pinned && close()} />
      </aside>
      {open === "click" && <div className="fade-in fixed inset-0 z-30 bg-[#0e1b3d]/20 backdrop-blur-[1px] dark:bg-black/40" onClick={close} aria-hidden />}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-hair bg-white/80 px-4 backdrop-blur sm:px-6 lg:px-10 dark:bg-slate-950/80">
          <button
            className={`flex items-center gap-2 rounded-lg p-2 text-ink-soft hover:bg-paper hover:text-ink dark:hover:bg-slate-800 ${pinned ? "lg:hidden" : ""}`}
            onClick={() => setOpen((o) => (o ? null : "click"))}
            aria-label="Abrir menú"
            aria-expanded={Boolean(open)}
          >
            <Menu className="size-5" />
            <span className="hidden text-[13px] sm:inline">Menú</span>
          </button>
          <div className="flex-1" />
          <button
            onClick={toggle}
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label={theme === "oscuro" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
          >
            {theme === "oscuro" ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </button>
          {me.data && <AccountMenu me={me.data} />}
        </header>
        {/* La información ocupa todo el ancho de la pantalla (con un tope para monitores muy anchos). */}
        <main className="mx-auto w-full max-w-[2200px] flex-1 px-4 py-8 sm:px-6 lg:px-10 2xl:px-14">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
