import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { FileText, Search, Settings, ShieldAlert, Sparkles, Upload } from "lucide-react";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Layout } from "./components/Layout";
import { EmptyState } from "./components/ui";
import { ApiError, api } from "./lib/api";
import { Campaign } from "./pages/Campaign";
import { Home } from "./pages/Home";
import { Placeholder } from "./pages/Placeholder";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Un 401/403/503 no se arregla reintentando.
      retry: (count, err) => !(err instanceof ApiError && [401, 403, 503].includes(err.status)) && count < 2,
    },
  },
});

/** Bloquea la app si no hay sesión válida y explica qué hacer. */
function SessionGate({ children }: { children: ReactNode }) {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 5 * 60_000 });
  if (me.isPending) {
    return <div className="flex min-h-dvh items-center justify-center text-sm text-slate-500">Verificando tu sesión…</div>;
  }
  if (me.isError) {
    const msg = me.error instanceof Error ? me.error.message : "No se pudo verificar tu sesión.";
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="max-w-md text-center">
          <ShieldAlert className="mx-auto mb-4 size-10 text-accent-500" aria-hidden />
          <h1 className="text-lg font-semibold">No pudimos abrir el CRM</h1>
          <p className="mt-2 text-sm text-slate-500">{msg}</p>
          <button onClick={() => location.reload()} className="mt-6 rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600">
            Volver a intentar
          </button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

const router = createBrowserRouter([
  {
    element: (
      <SessionGate>
        <Layout />
      </SessionGate>
    ),
    children: [
      { index: true, element: <Home /> },
      { path: "campanas/:code/:tab?", element: <Campaign /> },
      {
        path: "cliente",
        element: (
          <Placeholder title="Cliente (NIU)" subtitle="Todo lo que pasó con un cliente, en todas las campañas." icon={Search} phase="Fase 2">
            Buscador por NIU con la línea de tiempo de bases, llamadas, ventas y estatus del banco.
          </Placeholder>
        ),
      },
      {
        path: "carga",
        element: (
          <Placeholder title="Centro de carga" subtitle="Sábanas, bases, tipificaciones y ventas de cada mes." icon={Upload} phase="Fase 1">
            Arrastras el Excel, la app valida columnas, muestra una vista previa y las diferencias contra la versión anterior antes de guardar.
          </Placeholder>
        ),
      },
      {
        path: "reportes",
        element: (
          <Placeholder title="Reportes" subtitle="Presentación semanal y exportaciones." icon={FileText} phase="Fase 4">
            Tu presentación semanal generada sobre tu propia plantilla, con hoja de conciliación de cada cifra.
          </Placeholder>
        ),
      },
      {
        path: "preguntar",
        element: (
          <Placeholder title="Preguntar" subtitle="Preguntas en lenguaje natural sobre los resultados." icon={Sparkles} phase="Fase 5">
            Respuestas con números y gráficas a partir de métricas agregadas, nunca de datos de clientes.
          </Placeholder>
        ),
      },
      {
        path: "configuracion",
        element: (
          <Placeholder title="Configuración" subtitle="Metas, agentes, catálogos, cierres, bitácora y respaldos." icon={Settings} phase="Fase 1">
            Metas por campaña y mes, alias de agentes, clases de estatus y tipologías, y restauración de versiones.
          </Placeholder>
        ),
      },
      {
        path: "*",
        element: (
          <EmptyState icon={Search} title="Página no encontrada">
            Esa dirección no existe. Usa el menú para volver a una sección.
          </EmptyState>
        ),
      },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
