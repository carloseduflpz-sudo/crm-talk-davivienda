/* Campos de formulario y botones con el mismo estilo en toda la app. */
import { Eye, EyeOff } from "lucide-react";
import { useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";

/** "auth": el estilo limpio de las pantallas de entrada (etiqueta en mayúsculas, campo relleno). */
type Look = "default" | "auth";

const INPUT: Record<Look, string> = {
  default:
    "w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-900",
  auth: "w-full rounded-lg border border-blue-100 bg-[#e8f0fe] px-3.5 py-3 text-[15px] text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-900",
};
const LABEL: Record<Look, string> = {
  default: "mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200",
  auth: "mb-2 block text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400",
};

type FieldProps = { label: string; hint?: ReactNode; look?: Look } & InputHTMLAttributes<HTMLInputElement>;

export function Field({ label, hint, look = "default", ...props }: FieldProps) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={LABEL[look]}>
        {label}
      </label>
      <input id={id} className={INPUT[look]} {...props} />
      {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function PasswordField({ label, hint, look = "default", ...props }: FieldProps) {
  const id = useId();
  const [show, setShow] = useState(false);
  return (
    <div>
      <label htmlFor={id} className={LABEL[look]}>
        {label}
      </label>
      <div className="relative">
        <input id={id} type={show ? "text" : "password"} className={`${INPUT[look]} pr-11`} {...props} />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 hover:text-slate-600"
          aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Button({
  variant = "primary",
  loading,
  children,
  className = "",
  ...props
}: { variant?: "primary" | "secondary" | "danger" | "auth"; loading?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles = {
    primary: "bg-brand-500 text-white hover:bg-brand-600",
    auth: "w-full rounded-lg! py-3! font-semibold! bg-[#2563eb] text-white shadow-sm shadow-blue-600/20 hover:bg-[#1d4ed8]",
    secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800",
    danger: "bg-red-600 text-white hover:bg-red-700",
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${styles[variant]} ${className}`}
      {...props}
      disabled={loading || props.disabled}
    >
      {loading ? "Un momento…" : children}
    </button>
  );
}

export function ErrorMessage({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
      {children}
    </p>
  );
}

export const PASSWORD_HINT = "Mínimo 10 caracteres, con letras y números, sin incluir el usuario.";
