import { describe, expect, it } from "vitest";
import { readChart, readTables, texts } from "./pptx";
import { comoAntes, llenarPresentacion, semanaDe, semanasDelMes, type PresDeck, type PresentacionCampania, type PresVenta } from "./presentacion";

/* ---------- una presentación mínima en memoria ---------- */
const cell = (t: string) => `<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="900"/><a:t>${t}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`;
const table = (x: number, rows: string[][]) =>
  `<p:graphicFrame><p:xfrm><a:off x="${x}" y="0"/><a:ext cx="10" cy="${rows.length * 100}"/></p:xfrm><a:graphic><a:graphicData><a:tbl>${rows.map((r) => `<a:tr h="100">${r.map(cell).join("")}</a:tr>`).join("")}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
const chartFrame = (x: number, rid: string) => `<p:graphicFrame><p:xfrm><a:off x="${x}" y="0"/><a:ext cx="10" cy="10"/></p:xfrm><a:graphic><a:graphicData><c:chart r:id="${rid}"/></a:graphicData></a:graphic></p:graphicFrame>`;
const smartFrame = (rid: string) => `<p:graphicFrame><p:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></p:xfrm><a:graphic><a:graphicData><dgm:relIds r:dm="${rid}"/></a:graphicData></a:graphic></p:graphicFrame>`;
const smartData = (k: string, v: string, drawing: string) => `<dgm:dataModel><a:t>${k}</a:t><a:t>${v}</a:t><dsp:dataModelExt relId="${drawing}"/></dgm:dataModel>`;
const title = (t: string) => `<p:sp><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp>`;
const slide = (body: string, hidden = false) => `<p:sld${hidden ? ' show="0"' : ""}><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`;
const strCache = (xs: string[]) => `<c:strRef><c:strCache><c:ptCount val="${xs.length}"/>${xs.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("")}</c:strCache></c:strRef>`;
const numCache = (xs: (number | null)[]) =>
  `<c:numRef><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${xs.length}"/>${xs.map((v, i) => (v === null ? "" : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join("")}</c:numCache></c:numRef>`;
const chart = (t: string, series: { name: string; cats: string[]; vals: (number | null)[] }[]) =>
  `<c:chartSpace><c:chart>${t ? `<c:title><c:tx><c:rich><a:p><a:r><a:t>${t}</a:t></a:r></a:p></c:rich></c:tx></c:title>` : ""}<c:plotArea>${series
    .map((s) => `<c:ser><c:tx>${strCache([s.name])}</c:tx><c:cat>${strCache(s.cats)}</c:cat><c:val>${numCache(s.vals)}</c:val></c:ser>`)
    .join("")}</c:plotArea></c:chart></c:chartSpace>`;

function memoryDeck(parts: Record<string, string>, slideRels: Record<string, Record<string, string>>): PresDeck & { parts: Record<string, string> } {
  return {
    parts,
    has: (n) => n in parts,
    read: async (n) => parts[n]!,
    write: (n, x) => void (parts[n] = x),
    slides: async () => Object.keys(parts).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)),
    rels: async (n) => Object.entries(slideRels[n] ?? {}).map(([id, target]) => ({ id, type: "", target, external: false })),
  };
}

/* ---------- datos del mes ---------- */
let seq = 0;
const v = (o: Partial<PresVenta> & { ops: number }): PresVenta => ({
  grupo: null,
  origen: "mes",
  estatus: "ENTREGADA",
  k: 1,
  proceso: "",
  semana: 1,
  valor: o.ops,
  nius: Array.from({ length: o.ops }, () => String(++seq)),
  ...o,
});
const upin: PresentacionCampania = {
  campaign: "upin",
  month: "2026-10",
  unidad: "ventas",
  meta: 100,
  esperado: 80,
  diasHabiles: { transcurridos: 16, total: 22 },
  resultado: 60,
  fechaCorte: "2026-10-14",
  fechasPosteriores: null,
  bases: [
    {
      dataset: "upin:base",
      unicos: 1000,
      recorridos: 800,
      contactados: 400,
      llamadas: 1600,
      unIntento: 200,
      conVenta: 70,
      montoVenta: 0,
      contacto: [
        { label: "No contacto", n: 500 },
        { label: "Contacto efectivo", n: 250 },
        { label: "Sin asignar a un agente", n: 30 },
        { label: "Sin tipificar", n: 20 },
      ],
      mesAnterior: 900,
    },
  ],
  ventas: [
    v({ proceso: "UPGRADE", ops: 20, semana: 1 }),
    v({ proceso: "INCREMENTO", ops: 30, semana: 2 }),
    v({ proceso: "INCREMENTO", ops: 10, origen: "cosecha", semana: null }),
    v({ proceso: "UPGRADE", ops: 5, k: 0, estatus: "DEVOLUCION" }),
    v({ proceso: "UPGRADE", ops: 7, k: 0, estatus: "RECHAZADO" }),
    v({ proceso: "UPGRADE", ops: 3, k: 2, estatus: "ENTREGADA", origen: "cosecha", semana: null }),
  ],
  motivos: [
    { tipologia: "No le interesa", subtipologia: "Satisfecho con su limite", n: 600 },
    { tipologia: "No le interesa", subtipologia: "Por pago de membresía", n: 300 },
    { tipologia: "No le interesa", subtipologia: "Desconfianza", n: 60 },
    { tipologia: "No le interesa", subtipologia: "Otra cosa", n: 40 },
  ],
  trimestre: [{ month: "2026-10", meta: 100, metaPorAgente: 50, mtd: true, resultado: 60, porAgente: [{ agent: "Ana López", ventas: 35 }, { agent: "Luis Pérez", ventas: 25 }], agentes: ["Ana López", "Luis Pérez", "Supervisor"] }],
};

describe("presentación: semanas y formato", () => {
  it("semanas de lunes a domingo; la primera va del 1 al primer domingo", () => {
    expect(semanasDelMes("2026-10").map((w) => `${w.desde.slice(8)}-${w.hasta.slice(8)}`)).toEqual(["01-04", "05-11", "12-18", "19-25", "26-31"]);
    expect(semanaDe("2026-10", "2026-10-26")).toBe(5);
    expect(semanaDe("2026-10", "2026-09-30")).toBeNull();
  });

  it("escribe cada cifra con el estilo que ya tenía", () => {
    expect(comoAntes("1,264", 1300)).toBe("1,300");
    expect(comoAntes("2942", 3001)).toBe("3001");
    expect(comoAntes("47.3%", 12.345)).toBe("12.3%");
    expect(comoAntes("85%", 86.6)).toBe("87%");
    expect(comoAntes("$202,872.96", 1234.5)).toBe("$1,234.50");
    expect(comoAntes("2.2", 1.96)).toBe("2.0");
    expect(comoAntes("-89", -120)).toBe("-120");
  });
});

describe("presentación: llenado de las láminas", () => {
  const parts: Record<string, string> = {
    "ppt/slides/slide1.xml": slide(
      title("Upgrade Incremento") +
        table(0, [
          ["Cantado Vs Activo ", ""],
          ["Registros Únicos", "2942"],
          ["Registros Recorridos", "2506"],
          ["Nuevo", "436"],
          ["Ventas Cantadas", "549"],
          ["ventas activas", "359"],
          ["Activo Septiembre", "320"],
          ["cosecha", "39"],
          ["Devolucion", "61"],
          ["Pendiente", "6"],
          ["Aprobado", "0"],
        ]) +
        chartFrame(100, "rId1") +
        chartFrame(200, "rId2") +
        chartFrame(300, "rId3") +
        smartFrame("rId4") +
        smartFrame("rId6"),
    ),
    "ppt/slides/slide2.xml": slide(
      title("Upgrade e incrementos") +
        table(0, [
          ["Tipificación", "Cantidad", "%"],
          ["Satisfecho con su límite", "598", "47.3%"],
          ["Por pago de membresía", "77", "6.1%"],
          ["Otros motivos", "4", "0.3%"],
          ["No le interesa", "1,264", "100.0%"],
        ]),
    ),
    "ppt/slides/slide3.xml": slide(
      title("Gap de Incremento") +
        table(0, [
          ["Agente", "Antigüedad", "Primer Trimestre", "Segundo Trimestre", "Tercer Trimestre", "Cuarto trimestre", "Total"],
          ["ANA MARIA LOPEZ", "> 12", "-10", "-20", "-30", "-5", "-65"],
          ["PEDRO SALIDO", "> 6", "-1", "-1", "-1", "-1", "-4"],
        ]) +
        table(0, [
          ["Gap de Campaña", "", "", "", ""],
          ["Mes", "Meta", "Real", "% Cumplimiento", "Gap"],
          ["Primer Trimestre", "300", "250", "83%", "-50"],
          ["Cuarto trimestre", "90", "40", "44%", "-50"],
          ["Total", "390", "290", "74%", "-100"],
        ]),
    ),
    "ppt/slides/slide4.xml": slide(title("Compra de cartera") + table(0, [["Cantado Vs Activo", ""], ["Registros Únicos", "5"]])),
    "ppt/slides/slide5.xml": slide(title("Upgrade Incremento") + table(0, [["Cantado Vs Activo", ""], ["Registros Únicos", "5"]]), true),
    "ppt/diagrams/data1.xml": smartData("M", "253", "rId5"),
    "ppt/diagrams/drawing1.xml": `<dsp:drawing><a:t>M</a:t><a:t>253</a:t></dsp:drawing>`,
    "ppt/diagrams/data2.xml": smartData("R", "68", "rId7"),
    "ppt/diagrams/drawing2.xml": `<dsp:drawing><a:t>R</a:t><a:t>68</a:t></dsp:drawing>`,
    "ppt/charts/chart1.xml": chart("Contacto", [{ name: "Cantidad", cats: ["No contacto", "Contacto efectivo", "Sin Tipificar"], vals: [1, 2, 3] }]),
    "ppt/charts/chart2.xml": chart("", [{ name: "", cats: ["Cumplimiento", "GAP"], vals: [0.5, -0.5] }]),
    "ppt/charts/chart3.xml": chart("", [
      { name: "Upgrade", cats: ["W 1", "W2", "W 3", "W 4", "W 5"], vals: [4, 9, null, null, null] },
      { name: "Incremento", cats: ["W 1", "W2", "W 3", "W 4", "W 5"], vals: [6, 11, null, null, null] },
      { name: "Meta", cats: ["W 1", "W2", "W 3", "W 4", "W 5"], vals: [169, 169, 169, 169, 169] },
    ]),
  };
  const rels = { "ppt/slides/slide1.xml": { rId1: "ppt/charts/chart1.xml", rId2: "ppt/charts/chart2.xml", rId3: "ppt/charts/chart3.xml", rId4: "ppt/diagrams/data1.xml", rId5: "ppt/diagrams/drawing1.xml", rId6: "ppt/diagrams/data2.xml", rId7: "ppt/diagrams/drawing2.xml" } };

  it("Cantado vs Activo: base, cantadas, activas del mes, cosecha y estatus de mayor a menor", async () => {
    const deck = memoryDeck({ ...parts }, rels);
    const res = await llenarPresentacion(deck, { upin }, { mesPlantilla: "2026-10" });
    const t = readTables(deck.parts["ppt/slides/slide1.xml"]!)[0]!.cells;
    // cantadas = ventas del mes (20 + 30 + 5 + 7) + cosecha que cuenta (10); la cosecha que ya contó en septiembre no se repite.
    expect(t.slice(1)).toEqual([
      ["Registros Únicos", "1000"],
      ["Registros Recorridos", "800"],
      ["Nuevo", "200"],
      ["Ventas Cantadas", "72"],
      ["ventas activas", "60"],
      ["Activo Octubre", "50"],
      ["cosecha", "10"],
      ["Rechazado", "7"],
      ["Devolucion", "5"],
      ["Pendiente", "0"],
    ]);
    expect(res.cambios.some((c) => c.dato === "Etiqueta" && c.antes === "Activo Septiembre" && c.ahora === "Activo Octubre")).toBe(true);
    // CDC no se toca y la lámina oculta tampoco.
    expect(deck.parts["ppt/slides/slide4.xml"]).toBe(parts["ppt/slides/slide4.xml"]);
    expect(deck.parts["ppt/slides/slide5.xml"]).toBe(parts["ppt/slides/slide5.xml"]);
    expect(res.intactas.map((x) => x.lamina)).toEqual([4, 5]);
  });

  it("recuadro M = meta MTD (no la meta del mes) y R = resultado, en los datos y en el dibujo del SmartArt", async () => {
    const deck = memoryDeck({ ...parts }, rels);
    await llenarPresentacion(deck, { upin }, { mesPlantilla: "2026-10" });
    expect(texts(deck.parts["ppt/diagrams/data1.xml"]!)).toEqual(["M", "80"]);
    expect(texts(deck.parts["ppt/diagrams/drawing1.xml"]!)).toEqual(["M", "80"]);
    expect(texts(deck.parts["ppt/diagrams/data2.xml"]!)).toEqual(["R", "60"]);
    expect(texts(deck.parts["ppt/diagrams/drawing2.xml"]!)).toEqual(["R", "60"]);
  });

  it("gráficas: contacto (última llamada), cumplimiento MTD y semanas", async () => {
    const deck = memoryDeck({ ...parts }, rels);
    await llenarPresentacion(deck, { upin }, { mesPlantilla: "2026-10" });
    expect(readChart(deck.parts["ppt/charts/chart1.xml"]!)[0]).toMatchObject({ categories: ["No contacto", "Contacto efectivo", "Sin Tipificar"], values: [500, 250, 50] });
    expect(readChart(deck.parts["ppt/charts/chart2.xml"]!)[0]!.values).toEqual([0.75, -0.25]);
    // Corte el 14 → semana 3: las semanas 1 y 2 se respetan de la plantilla y la 3 es lo que falta para el total.
    const w = readChart(deck.parts["ppt/charts/chart3.xml"]!);
    expect(w[0]!.values).toEqual([4, 9, 7, null, null]); // upgrade activas: 20
    expect(w[1]!.values).toEqual([6, 11, 23, null, null]); // incremento activas: 30 del mes + 10 de cosecha
    expect(w[2]!.values).toEqual([20, 20, 20, 20, 20]); // meta / 5
  });

  it("semanas por fecha de venta cuando la plantilla es de otro mes", async () => {
    const deck = memoryDeck({ ...parts }, rels);
    await llenarPresentacion(deck, { upin }, { mesPlantilla: "2026-09" });
    const w = readChart(deck.parts["ppt/charts/chart3.xml"]!);
    expect(w[0]!.values).toEqual([20, 0, 0, null, null]);
    expect(w[1]!.values).toEqual([0, 30, 10, null, null]);
  });

  it("motivos de no venta: de mayor a menor, 'Otros motivos' y total", async () => {
    const deck = memoryDeck({ ...parts }, rels);
    await llenarPresentacion(deck, { upin }, { mesPlantilla: "2026-10" });
    expect(readTables(deck.parts["ppt/slides/slide2.xml"]!)[0]!.cells).toEqual([
      ["Tipificación", "Cantidad", "%"],
      ["Satisfecho con su límite", "600", "60.0%"],
      ["Por pago de membresía", "300", "30.0%"],
      ["Otros motivos", "100", "10.0%"],
      ["No le interesa", "1,000", "100.0%"],
    ]);
  });

  it("gap: trimestre actual por agente (con su antigüedad) y de la campaña", async () => {
    const deck = memoryDeck({ ...parts }, rels);
    await llenarPresentacion(deck, { upin }, { mesPlantilla: "2026-10" });
    const [agentes, campana] = readTables(deck.parts["ppt/slides/slide3.xml"]!);
    expect(agentes!.cells.slice(1)).toEqual([
      ["LUIS PÉREZ", "< 3", "0", "0", "0", "-25", "-25"],
      ["ANA MARIA LOPEZ", "> 12", "-10", "-20", "-30", "-15", "-75"],
    ]);
    expect(campana!.cells.slice(2)).toEqual([
      ["Primer Trimestre", "300", "250", "83%", "-50"],
      ["Cuarto trimestre", "100", "60", "60%", "-40"],
      ["Total", "400", "310", "78%", "-90"],
    ]);
    expect(texts(deck.parts["ppt/slides/slide3.xml"]!).includes("PEDRO SALIDO")).toBe(false);
  });
});
