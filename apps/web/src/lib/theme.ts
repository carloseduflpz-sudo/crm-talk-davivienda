import { useCallback, useEffect, useState } from "react";

export type Theme = "claro" | "oscuro";
const KEY = "crm-tema";

function current(): Theme {
  return document.documentElement.classList.contains("dark") ? "oscuro" : "claro";
}

/** Tema claro/oscuro, guardado por usuario en su navegador. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(current);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "oscuro");
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // navegador sin almacenamiento: el tema dura solo esta visita
    }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === "oscuro" ? "claro" : "oscuro")), []);
  return { theme, toggle };
}
