/* Homologación de nombres de agentes: el mismo agente aparece escrito distinto en la sábana del banco,
   en VICI y en el CRM ("MARIA JOSE LOPEZ RIVERA", "María López", "lopez maria", "Maria Lopes").
   La herramienta los une sola, sin que nadie mantenga una lista:
   - no importan mayúsculas, tildes, puntos, espacios de más ni el orden de nombres y apellidos;
   - un nombre corto se une al completo si coincide con UNO solo ("María López" → "María José López Rivera");
   - se toleran errores de una letra en palabras de 4 letras o más ("Martines" = "Martínez");
   - si un nombre podría ser de dos agentes distintos, no se une a ninguno (mejor separado que mal unido). */

/** Palabras que no distinguen a una persona. */
const PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "da", "das", "do", "dos", "van", "von", "e"]);

const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Palabras de un nombre, sin tildes, en minúsculas y sin partículas: "María de los Ángeles" → ["maria", "angeles"]. */
export function nameTokens(name: string): string[] {
  return stripAccents(name)
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !PARTICLES.has(t));
}

/** Distancia de edición, cortando apenas pasa de `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** ¿Dos palabras son la misma? Igual, o con un error de una letra si ambas tienen 4 letras o más. */
function sameWord(a: string, b: string): boolean {
  return a === b || (Math.min(a.length, b.length) >= 4 && editDistance(a, b, 1) <= 1);
}

/** ¿Todas las palabras de `small` están en `big` (cada una contra una palabra distinta)? Primero exactas, luego parecidas. */
function covers(big: string[], small: string[]): boolean {
  const free = [...big];
  const pending: string[] = [];
  for (const t of small) {
    const i = free.indexOf(t);
    if (i >= 0) free.splice(i, 1);
    else pending.push(t);
  }
  for (const t of pending) {
    const i = free.findIndex((f) => sameWord(f, t));
    if (i < 0) return false;
    free.splice(i, 1);
  }
  return true;
}

/** ¿Pueden ser la misma persona? Hace falta al menos nombre y apellido (2 palabras) en el más corto. */
function sameAgent(a: string[], b: string[]): boolean {
  const [small, big] = a.length <= b.length ? [a, b] : [b, a];
  if (small.length < 2) return false;
  return covers(big, small);
}

const keyOf = (tokens: string[]) => [...tokens].sort().join(" ");

const hasAccents = (s: string) => stripAccents(s) !== s;
const isShouting = (s: string) => s === s.toUpperCase() || s === s.toLowerCase();

/** "MARIA JOSE DE LA O" → "Maria Jose de la O". Respeta lo que ya viene bien escrito. */
function titleCase(word: string): string {
  const lower = word.toLowerCase();
  if (PARTICLES.has(lower)) return lower;
  return lower.replace(/(^|[-'])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

export interface AgentVariant {
  raw: string;
  /** Cuántas filas traen ese nombre (pesa para elegir cómo se muestra). */
  rows: number;
}

export interface AgentGroup {
  /** Cómo se muestra en toda la herramienta. */
  name: string;
  /** Las formas en que viene escrito en los archivos (incluida la que coincide con `name`, si viene así). */
  variants: string[];
}

/** El nombre a mostrar: el más completo, con tildes donde alguna variante las trae y en mayúsculas/minúsculas normales. */
function displayName(members: AgentVariant[]): string {
  // Mejor ortografía de cada palabra: con tildes y bien escrita gana.
  const spelling = new Map<string, { word: string; score: number }>();
  for (const m of members) {
    const shouting = isShouting(m.raw);
    for (const w of m.raw.split(/\s+/).filter(Boolean)) {
      const k = nameTokens(w)[0];
      if (!k) continue;
      const pretty = shouting ? titleCase(w) : w;
      const score = (hasAccents(w) ? 4 : 0) + (shouting ? 0 : 2) + Math.min(m.rows, 1_000_000) / 1_000_000;
      const cur = spelling.get(k);
      if (!cur || score > cur.score) spelling.set(k, { word: pretty.replace(/[^\p{L}'-]/gu, ""), score });
    }
  }
  // La forma base: la más completa; entre iguales, la mejor escrita (con tildes, sin todo en mayúsculas) y la más usada.
  const quality = (raw: string) => (hasAccents(raw) ? 2 : 0) + (isShouting(raw) ? 0 : 1);
  const base = [...members].sort(
    (x, y) => nameTokens(y.raw).length - nameTokens(x.raw).length || quality(y.raw) - quality(x.raw) || y.rows - x.rows || x.raw.localeCompare(y.raw),
  )[0]!;
  return base.raw
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const lower = stripAccents(w).toLowerCase().replace(/[^a-z]/g, "");
      if (PARTICLES.has(lower)) return w.toLowerCase();
      const k = nameTokens(w)[0];
      return (k && spelling.get(k)?.word) || titleCase(w);
    })
    .filter(Boolean)
    .join(" ");
}

/**
 * Agrupa los nombres que son el mismo agente. Devuelve un grupo por agente (con al menos una variante).
 * Determinista: el mismo listado siempre da los mismos grupos.
 */
export function homologateAgents(names: readonly AgentVariant[]): AgentGroup[] {
  const clean = new Map<string, number>();
  for (const n of names) {
    const raw = n.raw.trim();
    if (raw) clean.set(raw, (clean.get(raw) ?? 0) + n.rows);
  }
  // Los nombres más completos primero: así los cortos se comparan contra todos los completos.
  const items = [...clean]
    .map(([raw, rows]) => ({ raw, rows, tokens: nameTokens(raw) }))
    .sort((a, b) => b.tokens.length - a.tokens.length || b.rows - a.rows || a.raw.localeCompare(b.raw));

  const groups: { members: typeof items; keys: Set<string> }[] = [];
  for (const it of items) {
    const key = keyOf(it.tokens);
    // Mismas palabras (en cualquier orden, sin tildes ni mayúsculas): es el mismo, sin dudas.
    let target = it.tokens.length ? groups.find((g) => g.keys.has(key)) : undefined;
    if (!target && it.tokens.length >= 2) {
      const candidates = groups.filter((g) => g.members.some((m) => sameAgent(m.tokens, it.tokens)));
      if (candidates.length === 1) target = candidates[0];
    }
    if (target) {
      target.members.push(it);
      target.keys.add(key);
    } else {
      groups.push({ members: [it], keys: new Set([key]) });
    }
  }
  return groups.map((g) => ({ name: displayName(g.members), variants: g.members.map((m) => m.raw).sort((a, b) => a.localeCompare(b, "es")) }));
}

/** Diccionario nombre-tal-como-viene → nombre homologado (solo los que cambian). */
export function agentRenames(groups: readonly AgentGroup[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const g of groups) for (const v of g.variants) if (v !== g.name) out.set(v, g.name);
  return out;
}
