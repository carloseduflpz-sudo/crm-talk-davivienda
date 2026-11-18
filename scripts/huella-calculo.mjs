// Huella del código que calcula las cifras (API, núcleo y migraciones). Se usa para guardar los resultados ya
// calculados: si una publicación solo cambia la pantalla, la huella no cambia y no hay que recalcular nada.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const raiz = new URL("..", import.meta.url).pathname;
const carpetas = ["apps/api/src", "packages/core/src", "packages/db/migrations"];
const salida = "apps/api/src/huella.ts";

const archivos = [];
const recorrer = (dir) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) recorrer(p);
    else if (/\.(ts|sql)$/.test(n) && !/\.test\.ts$/.test(n)) archivos.push(p);
  }
};
for (const c of carpetas) recorrer(join(raiz, c));

const h = createHash("sha256");
for (const p of archivos.map((x) => relative(raiz, x)).filter((x) => x !== salida).sort()) {
  h.update(p);
  h.update(readFileSync(join(raiz, p)));
}
const huella = h.digest("hex").slice(0, 16);
writeFileSync(join(raiz, salida), `// Generado al compilar (scripts/huella-calculo.mjs).\nexport const HUELLA_CALCULO: string = "${huella}";\n`);
console.log(`Huella del cálculo: ${huella}`);
