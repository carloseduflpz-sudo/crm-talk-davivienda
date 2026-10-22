/* Pantalla de entrada. Si la app todavía no tiene usuarios, muestra la configuración inicial. */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button, ErrorMessage, Field, PASSWORD_HINT, PasswordField } from "../components/form";
import { api } from "../lib/api";

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      {/* Panel de marca (solo en pantallas grandes) */}
      <div className="relative hidden flex-1 overflow-hidden bg-gradient-to-br from-[#6cb86e] via-[#1da6f2] to-[#46afad] lg:block">
        <div className="absolute inset-x-0 bottom-0 h-1/3 rounded-t-[50%] bg-slate-50 dark:bg-slate-950" />
        <div className="relative p-12">
          <p className="text-3xl font-bold text-brand-900">CRM Talk</p>
          <p className="mt-1 text-lg font-light text-white">Davivienda · resultados de las 6 campañas</p>
        </div>
      </div>
      <div className="flex w-full items-center justify-center p-6 lg:max-w-xl">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3">
            <img src="/favicon.svg" alt="" className="size-10" />
            <div className="leading-tight">
              <p className="font-semibold text-brand-900 dark:text-white">CRM Talk</p>
              <p className="text-sm text-slate-500">Davivienda</p>
            </div>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 mb-6 text-sm text-slate-500">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

function LoginForm({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useMutation({ mutationFn: api.login, onSuccess: onDone });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ username, password });
  };

  return (
    <Shell title="Bienvenido" subtitle="Entra con el usuario y la contraseña que te asignaron.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Usuario" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={username} onChange={(e) => setUsername(e.target.value)} />
        <PasswordField label="Contraseña" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorMessage>{login.error?.message}</ErrorMessage>
        <Button type="submit" loading={login.isPending} className="w-full">
          Entrar
        </Button>
        <p className="text-center text-xs text-slate-500">¿Olvidaste tu contraseña? Pide a un administrador que te asigne una nueva.</p>
      </form>
    </Shell>
  );
}

function SetupForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ token: "", displayName: "", username: "", password: "", confirm: "" });
  const [localError, setLocalError] = useState("");
  const setup = useMutation({ mutationFn: api.setup, onSuccess: onDone });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setLocalError("");
    if (form.password !== form.confirm) return setLocalError("Las contraseñas no coinciden.");
    setup.mutate({ token: form.token, displayName: form.displayName, username: form.username, password: form.password });
  };

  return (
    <Shell title="Configuración inicial" subtitle="Crea el primer administrador. Este paso solo aparece una vez.">
      <form onSubmit={submit} className="space-y-4">
        <PasswordField
          label="Clave de configuración"
          hint="La que guardaste como SETUP_TOKEN en Cloudflare."
          autoComplete="off"
          required
          value={form.token}
          onChange={set("token")}
        />
        <Field label="Tu nombre" autoComplete="name" required value={form.displayName} onChange={set("displayName")} />
        <Field
          label="Usuario"
          hint="De 3 a 32 caracteres: letras, números, punto o guion. Ejemplo: carlos.perez"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={form.username}
          onChange={set("username")}
        />
        <PasswordField label="Contraseña" hint={PASSWORD_HINT} autoComplete="new-password" required value={form.password} onChange={set("password")} />
        <PasswordField label="Repite la contraseña" autoComplete="new-password" required value={form.confirm} onChange={set("confirm")} />
        <ErrorMessage>{localError || setup.error?.message}</ErrorMessage>
        <Button type="submit" loading={setup.isPending} className="w-full">
          Crear administrador y entrar
        </Button>
      </form>
    </Shell>
  );
}

export function Login({ onDone }: { onDone: () => void }) {
  const status = useQuery({ queryKey: ["auth-status"], queryFn: api.authStatus });
  if (status.isPending) return <div className="flex min-h-dvh items-center justify-center text-sm text-slate-500">Cargando…</div>;
  if (status.data?.needsSetup) return <SetupForm onDone={onDone} />;
  return <LoginForm onDone={onDone} />;
}
