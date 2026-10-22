/* Normalización de texto para comparar valores que vienen de Excel del banco y de VICI. */

/** Quita tildes, saltos de línea y espacios repetidos. Mantiene mayúsculas/minúsculas. */
export function cleanText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Llave de comparación: sin tildes, sin espacios de más y en mayúsculas. */
export function matchKey(value: unknown): string {
  return cleanText(value).toUpperCase();
}

/**
 * NIU normalizado: solo dígitos y sin ceros a la izquierda.
 * Acepta números de Excel ("12345.0", notación científica) y quita espacios y guiones.
 * Devuelve "" si no es un NIU válido (esas filas se descartan y se reportan).
 */
export function normalizeNiu(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value).trim();
  if (s === "" || /^(none|nan|null)$/i.test(s)) return "";
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, "");
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(s)) s = String(Math.round(Number(s)));
  s = s.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(s)) return "";
  return s.replace(/^0+(?=\d)/, "");
}
