/* Administración de usuarios: alta, contraseñas temporales, roles, activar/desactivar y desbloqueo. */
import { ROLES, type Role } from "@crm/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Lock, Plus, Unlock, UserCheck, UserX, Wand2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button, ErrorMessage, Field, PASSWORD_HINT } from "../components/form";
import { Badge, Card, PageHeader } from "../components/ui";
import { api, type Me, type UserAccount } from "../lib/api";

export const ROLE_LABEL: Record<Role, string> = { admin: "Administrador", editor: "Editor", lector: "Solo lectura" };
const ROLE_HELP: Record<Role, string> = {
  admin: "Todo, incluido administrar usuarios",
  editor: "Ver, cargar archivos y generar reportes",
  lector: "Solo ver",
};

/** Contraseña temporal legible que cumple la política (letras y números, 12 caracteres). */
function generatePassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const pick = (set: string, n: number) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => set[x % set.length]).join("");
  return `${pick(letters, 4)}-${pick(digits, 4)}-${pick(letters, 2)}${pick(digits, 1)}`;
}

const fmtDate = (ms: number | null) =>
  ms ? new Intl.DateTimeFormat("es-SV", { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms)) : "Nunca";

function TempPasswordNotice({ username, password, onClose }: { username: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `Usuario: ${username}\nContraseña temporal: ${password}`;
  return (
    <Card className="mb-6 border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10">
      <p className="font-medium text-emerald-800 dark:text-emerald-200">Comparte estos datos con la persona por un medio privado</p>
      <pre className="mt-3 rounded-xl bg-white p-3 font-mono text-sm dark:bg-slate-900">{text}</pre>
      <p className="mt-2 text-xs text-emerald-800/80 dark:text-emerald-200/80">Al entrar, la app le pedirá crear su propia contraseña. Esta no se vuelve a mostrar.</p>
      <div className="mt-3 flex gap-2">
        <Button
          variant="secondary"
          onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}
        >
          <Copy className="size-4" aria-hidden /> {copied ? "Copiado" : "Copiar"}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Listo
        </Button>
      </div>
    </Card>
  );
}

function NewUserForm({ onCreated, onCancel }: { onCreated: (username: string, password: string) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ displayName: "", username: "", role: "admin" as Role, password: generatePassword() });
  const create = useMutation({
    mutationFn: api.createUser,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["users"] });
      onCreated(form.username.trim().toLowerCase(), form.password);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(form);
  };
  return (
    <Card className="mb-6">
      <h2 className="mb-4 font-semibold">Nuevo usuario</h2>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre completo" required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        <Field
          label="Usuario"
          hint="Ejemplo: ana.lopez"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
        />
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200" htmlFor="rol-nuevo">
            Rol
          </label>
          <select
            id="rol-nuevo"
            className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]} — {ROLE_HELP[r]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Field label="Contraseña temporal" hint={PASSWORD_HINT} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <button type="button" onClick={() => setForm({ ...form, password: generatePassword() })} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-600">
            <Wand2 className="size-3.5" aria-hidden /> Generar otra
          </button>
        </div>
        <div className="sm:col-span-2">
          <ErrorMessage>{create.error?.message}</ErrorMessage>
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" loading={create.isPending}>
            Crear usuario
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}

function UserRow({ u, me, onTempPassword }: { u: UserAccount; me: Me; onTempPassword: (username: string, password: string) => void }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });
  const update = useMutation({ mutationFn: (b: Parameters<typeof api.updateUser>[1]) => api.updateUser(u.id, b), onSuccess: refresh });
  const reset = useMutation({
    mutationFn: (password: string) => api.resetPassword(u.id, password),
    onSuccess: (_d, password) => {
      void refresh();
      onTempPassword(u.username, password);
    },
  });
  const isMe = u.id === me.id;
  const error = update.error?.message || reset.error?.message;

  return (
    <li className={`flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center ${u.active ? "" : "opacity-60"}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{u.displayName}</p>
          {isMe && <Badge tone="brand">Tú</Badge>}
          {!u.active && <Badge>Desactivado</Badge>}
          {u.lockedUntil && <Badge tone="accent">Bloqueado</Badge>}
          {u.mustChangePassword && u.active && <Badge>Contraseña temporal</Badge>}
        </div>
        <p className="mt-0.5 text-sm text-slate-500">
          {u.username} · Último ingreso: {fmtDate(u.lastLoginAt)}
        </p>
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={`Rol de ${u.displayName}`}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          value={u.role}
          disabled={update.isPending}
          onChange={(e) => update.mutate({ role: e.target.value as Role })}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        {u.lockedUntil && (
          <Button variant="secondary" onClick={() => update.mutate({ unlock: true })} loading={update.isPending}>
            <Unlock className="size-4" aria-hidden /> Desbloquear
          </Button>
        )}
        {!isMe && (
          <>
            <Button
              variant="secondary"
              loading={reset.isPending}
              onClick={() => {
                if (confirm(`¿Asignar una contraseña temporal nueva a ${u.displayName}? Se cerrarán sus sesiones abiertas.`)) reset.mutate(generatePassword());
              }}
            >
              <KeyRound className="size-4" aria-hidden /> Nueva contraseña
            </Button>
            <Button
              variant="secondary"
              loading={update.isPending}
              onClick={() => {
                if (!u.active || confirm(`¿Desactivar a ${u.displayName}? No podrá entrar hasta que lo vuelvas a activar.`)) update.mutate({ active: !u.active });
              }}
            >
              {u.active ? <UserX className="size-4" aria-hidden /> : <UserCheck className="size-4" aria-hidden />}
              {u.active ? "Desactivar" : "Activar"}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

export function Users() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 5 * 60_000 });
  const users = useQuery({ queryKey: ["users"], queryFn: api.users });
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{ username: string; password: string } | null>(null);

  if (me.data && !me.data.permissions.includes("usuarios:administrar")) {
    return (
      <>
        <PageHeader title="Usuarios" />
        <Card>
          <p className="flex items-center gap-2 text-sm text-slate-600">
            <Lock className="size-4" aria-hidden /> Solo un administrador puede gestionar usuarios.
          </p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Usuarios"
        subtitle="Quién puede entrar al CRM y qué puede hacer."
        actions={
          !creating && (
            <Button onClick={() => (setNotice(null), setCreating(true))}>
              <Plus className="size-4" aria-hidden /> Nuevo usuario
            </Button>
          )
        }
      />
      {notice && <TempPasswordNotice {...notice} onClose={() => setNotice(null)} />}
      {creating && (
        <NewUserForm
          onCancel={() => setCreating(false)}
          onCreated={(username, password) => {
            setCreating(false);
            setNotice({ username, password });
          }}
        />
      )}
      <Card className="p-0">
        {users.isPending && <p className="p-5 text-sm text-slate-500">Cargando usuarios…</p>}
        {users.isError && <p className="p-5 text-sm text-red-600">{users.error.message}</p>}
        {users.data && me.data && (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {users.data.map((u) => (
              <UserRow key={u.id} u={u} me={me.data} onTempPassword={(username, password) => setNotice({ username, password })} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
