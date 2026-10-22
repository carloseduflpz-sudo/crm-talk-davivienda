import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AuthShell } from "../components/AuthShell";
import { Button, ErrorMessage, PASSWORD_HINT, PasswordField } from "../components/form";
import { Card, PageHeader } from "../components/ui";
import { api } from "../lib/api";

/** Cambio de contraseña. Con `forced`, es la pantalla obligatoria del primer ingreso. */
export function ChangePassword({ forced = false }: { forced?: boolean }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [localError, setLocalError] = useState("");
  const [done, setDone] = useState(false);
  const change = useMutation({
    mutationFn: api.changePassword,
    onSuccess: async () => {
      setForm({ current: "", next: "", confirm: "" });
      setDone(true);
      await qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setLocalError("");
    setDone(false);
    if (form.next !== form.confirm) return setLocalError("Las contraseñas nuevas no coinciden.");
    change.mutate({ currentPassword: form.current, newPassword: form.next });
  };

  const look = forced ? "auth" : "default";
  const body = (
    <form onSubmit={submit} className="space-y-4">
      <PasswordField look={look} label={forced ? "Contraseña temporal" : "Contraseña actual"} autoComplete="current-password" required value={form.current} onChange={set("current")} />
      <PasswordField look={look} label="Contraseña nueva" hint={PASSWORD_HINT} autoComplete="new-password" required value={form.next} onChange={set("next")} />
      <PasswordField look={look} label="Repite la contraseña nueva" autoComplete="new-password" required value={form.confirm} onChange={set("confirm")} />
      <ErrorMessage>{localError || change.error?.message}</ErrorMessage>
      {done && !forced && <p className="rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">Listo, tu contraseña quedó cambiada. Las sesiones en otros dispositivos se cerraron.</p>}
      <div className="pt-1">
        <Button type="submit" variant={forced ? "auth" : "primary"} loading={change.isPending}>
          Guardar contraseña
        </Button>
      </div>
    </form>
  );

  if (forced) {
    return (
      <AuthShell
        title="Crea tu contraseña"
        subtitle="Entraste con una contraseña temporal. Elige una nueva que solo tú conozcas."
        footer={
          <button onClick={() => api.logout().finally(() => location.assign("/"))} className="underline-offset-2 hover:underline">
            Cerrar sesión
          </button>
        }
      >
        {body}
      </AuthShell>
    );
  }

  return (
    <>
      <PageHeader title="Cambiar contraseña" subtitle="Al guardarla, se cierran tus sesiones en otros dispositivos." />
      <Card className="max-w-md">{body}</Card>
    </>
  );
}
