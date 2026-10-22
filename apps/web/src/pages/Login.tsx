/* Pantalla de entrada. Si la app todavía no tiene usuarios, muestra la configuración inicial. */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AuthShell } from "../components/AuthShell";
import { Button, ErrorMessage, Field, PASSWORD_HINT, PasswordField } from "../components/form";
import { api } from "../lib/api";

function LoginForm({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useMutation({ mutationFn: api.login, onSuccess: onDone });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ username, password });
  };

  return (
    <AuthShell
      title="Iniciar sesión"
      subtitle="Usa la cuenta que te dio tu administrador."
      footer="¿Olvidaste tu contraseña? Pide a tu administrador una nueva."
    >
      <form onSubmit={submit} className="space-y-4">
        <Field
          look="auth"
          label="Usuario"
          autoComplete="username"
          autoCapitalize="none"
          autoFocus
          spellCheck={false}
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <PasswordField look="auth" label="Contraseña" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorMessage>{login.error?.message}</ErrorMessage>
        <div className="pt-1">
          <Button type="submit" variant="auth" loading={login.isPending}>
            Ingresar
          </Button>
        </div>
      </form>
    </AuthShell>
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
    <AuthShell title="Configuración inicial" subtitle="Crea el primer administrador. Este paso solo aparece una vez.">
      <form onSubmit={submit} className="space-y-4">
        <PasswordField
          look="auth"
          label="Clave de configuración"
          hint="La que guardaste como SETUP_TOKEN en Cloudflare."
          autoComplete="off"
          required
          value={form.token}
          onChange={set("token")}
        />
        <Field look="auth" label="Tu nombre" autoComplete="name" required value={form.displayName} onChange={set("displayName")} />
        <Field
          look="auth"
          label="Usuario"
          hint="De 3 a 32 caracteres: letras, números, punto o guion. Ejemplo: carlos.perez"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={form.username}
          onChange={set("username")}
        />
        <PasswordField look="auth" label="Contraseña" hint={PASSWORD_HINT} autoComplete="new-password" required value={form.password} onChange={set("password")} />
        <PasswordField look="auth" label="Repite la contraseña" autoComplete="new-password" required value={form.confirm} onChange={set("confirm")} />
        <ErrorMessage>{localError || setup.error?.message}</ErrorMessage>
        <div className="pt-1">
          <Button type="submit" variant="auth" loading={setup.isPending}>
            Crear administrador e ingresar
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}

export function Login({ onDone }: { onDone: () => void }) {
  const status = useQuery({ queryKey: ["auth-status"], queryFn: api.authStatus });
  if (status.isPending) return <div className="flex min-h-dvh items-center justify-center bg-[#eef5ff] text-sm text-slate-500 dark:bg-slate-950">Cargando…</div>;
  if (status.data?.needsSetup) return <SetupForm onDone={onDone} />;
  return <LoginForm onDone={onDone} />;
}
