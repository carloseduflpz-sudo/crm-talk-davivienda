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
  hc: 2,
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
    "ppt/charts/chart1.xml": chart("Contacto", [{ name: "Cantidad", cats: ["No contacto", "Contacto efectivo", "Sin Tipificar"], vals: [1, 2, 3] }]).replace(
      "</c:chartSpace>",
      '<c:externalData r:id="rId9"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>',
    ),
    "ppt/charts/_rels/chart1.xml.rels":
      '<Relationships><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="file:///C:\\DAVIVIENDA.xlsx" TargetMode="External"/><Relationship Id="rId1" Type="x" Target="style1.xml"/></Relationships>',
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
    // CDC sin datos del mes: se deja igual y se avisa. La lámina oculta tampoco se toca.
    expect(deck.parts["ppt/slides/slide4.xml"]).toBe(parts["ppt/slides/slide4.xml"]);
    expect(deck.parts["ppt/slides/slide5.xml"]).toBe(parts["ppt/slides/slide5.xml"]);
    expect(res.intactas.map((x) => x.lamina)).toEqual([5]);
    expect(res.sinCambio.find((x) => x.lamina === 4)?.motivo).toContain("No hay datos");
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
    // Desligada del Excel externo: "Actualizar vínculos" ya no puede traer otros números.
    expect(deck.parts["ppt/charts/chart1.xml"]!.includes("externalData")).toBe(false);
    expect(deck.parts["ppt/charts/_rels/chart1.xml.rels"]).toBe('<Relationships><Relationship Id="rId1" Type="x" Target="style1.xml"/></Relationships>');
    expect(readChart(deck.parts["ppt/charts/chart2.xml"]!)[0]!.values).toEqual([0.75, -0.25]);
    // Cumplimiento redondeado al entero (43.6% → 44%) y la etiqueta sin decimales.
    const deck2 = memoryDeck({ ...parts, "ppt/charts/chart2.xml": parts["ppt/charts/chart2.xml"]!.replace("<c:formatCode>General</c:formatCode>", "<c:formatCode>0.0%</c:formatCode>") }, rels);
    await llenarPresentacion(deck2, { upin: { ...upin, resultado: 43.6, esperado: 100 } }, { mesPlantilla: "2026-10" });
    expect(readChart(deck2.parts["ppt/charts/chart2.xml"]!)[0]!.values).toEqual([0.44, -0.56]);
    expect(deck2.parts["ppt/charts/chart2.xml"]!.includes("<c:formatCode>0%</c:formatCode>")).toBe(true);
    // Corte el 14 → semana 3: las semanas 1 y 2 se respetan de la plantilla y la 3 es lo que falta para el total.
    const w = readChart(deck.parts["ppt/charts/chart3.xml"]!);
    expect(w[0]!.values).toEqual([4, 9, 7, null, null]); // upgrade activas: 20
    expect(w[1]!.values).toEqual([6, 11, 23, null, null]); // incremento activas: 30 del mes + 10 de cosecha
    expect(w[2]!.values).toEqual([20, 20, 20, 20, 20]); // meta / 5
  });

  it("con el Excel de las gráficas, el contacto sale de su hoja", async () => {
    const deck = memoryDeck({ ...parts }, rels);
    const conExcel = { ...upin, contactoExcel: { "*": [{ label: "Sin Tipificar", n: 3 }, { label: "No contacto", n: 9 }] } };
    await llenarPresentacion(deck, { upin: conExcel }, { mesPlantilla: "2026-10" });
    expect(readChart(deck.parts["ppt/charts/chart1.xml"]!)[0]).toMatchObject({ categories: ["No contacto", "Sin Tipificar"], values: [9, 3] });
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

  it("CDC y Extra se llenan en dólares (Activas <mes>, cosecha y estatus por monto)", async () => {
    const deck = memoryDeck(
      {
        "ppt/slides/slide1.xml": slide(
          title("Compra de Cartera") +
            table(0, [
              ["Cantado Vs Activo", ""],
              ["Ventas cantadas", "$202,872.96"],
              ["Ventas activas", "$188,744.96"],
              ["Activas Septiembre", "$183,189.96"],
              ["Cosecha", "$5,555.00"],
              ["No aplica", "$4,878.00"],
              ["Desistido", "$400.00"],
            ]),
        ),
      },
      {},
    );
    const cdc: PresentacionCampania = {
      ...upin,
      campaign: "cdc",
      unidad: "monto",
      ventas: [
        v({ estatus: "APLICADO", ops: 2, valor: 1000.5 }),
        v({ estatus: "NO APLICA", k: 0, ops: 1, valor: 300 }),
        v({ estatus: "APLICADO", origen: "cosecha", semana: null, ops: 1, valor: 200 }),
        v({ estatus: "NO APLICA", k: 0, origen: "cosecha", semana: null, ops: 1, valor: 999 }),
      ],
    };
    await llenarPresentacion(deck, { cdc }, { mesPlantilla: "2026-10" });
    expect(readTables(deck.parts["ppt/slides/slide1.xml"]!)[0]!.cells.slice(1)).toEqual([
      ["Ventas cantadas", "$1,500.50"],
      ["Ventas activas", "$1,200.50"],
      ["Activas Octubre", "$1,000.50"],
      ["Cosecha", "$200.00"],
      ["No aplica", "$300.00"],
      ["Desistido", "$0.00"],
    ]);
  });

  it("Seguimiento de documentos (TDC): requieren, recuperados, documentos pedidos y rechazos", async () => {
    const deck = memoryDeck(
      {
        "ppt/slides/slide1.xml": slide(
          title("Seguimiento de documentos") +
            table(0, [["Motivo de Rechazo", "Total", "%"], ["Mora Actual", "9", "39%"], ["Alto Endeudamiento", "7", "31%"], ["Otros", "4", "17%"]]) +
            table(0, [["Cliente pendiente de documento", "Clientes recuperados", "Porcentaje"], ["151", "96", "64%"]]) +
            table(0, [["Total de clientes", "No requiere Doc.", "Requiere Doc."], ["207", "56", "151"], ["%", "27%", "73%"]]) +
            table(0, [["Doc. Solicitado", "Total"], ["BOLETAS DE PAGO", "120"], ["RECIBO", "63"], ["DUI", "29"]]) +
            table(0, [["Rechazado PCBM", ""], ["Cliente", "23"]]),
        ),
      },
      {},
    );
    const doc = (estatus: string, d: string | null, motivo: string | null = null) => ({ estatus, doc: d, pendiente: null, motivo });
    const tdc: PresentacionCampania = {
      ...upin,
      campaign: "tdc",
      documentos: [
        doc("ENTREGADA", "BOLETAS DE PAGO, RECIBO"),
        doc("PENDIENTE POR REQUISITO", "BOLETA DE PAGO"),
        doc("PENDIENTE POR REQUISITO/VENCIDOS", "DUI"),
        doc("RECHAZADA", "RECIBO", "Alto Endeudamiento"),
        doc("RECHAZADA", null, "Mora Actual"),
        doc("RECHAZADA", "NO REQUIERE", "Base Vencida"),
        doc("ENTREGADA", null),
        doc("ENTREGADA", "No"),
      ],
    };
    await llenarPresentacion(deck, { tdc }, { mesPlantilla: "2026-10" });
    const [rech, pend, tot, docs, pcbm] = readTables(deck.parts["ppt/slides/slide1.xml"]!);
    expect(pend!.cells[1]).toEqual(["4", "2", "50%"]); // requieren 4 (2 siguen pendientes): recuperados 2
    expect(tot!.cells.slice(1)).toEqual([["8", "4", "4"], ["%", "50%", "50%"]]);
    expect(docs!.cells.slice(1)).toEqual([["BOLETAS DE PAGO", "2"], ["RECIBO", "2"], ["DUI", "1"]]);
    expect(pcbm!.cells[1]).toEqual(["Cliente", "3"]);
    expect(rech!.cells.slice(1)).toEqual([["Mora Actual", "1", "33%"], ["Alto Endeudamiento", "1", "33%"], ["Base Vencida", "1", "33%"]]);
  });

  it("motivos cuyo total dice solo \"Total\": la tipología sale del título que está encima de la tabla", async () => {
    const encima = (t: string, x: number, y: number) => `<p:sp><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp>`;
    const tabla = (x: number, rows: string[][]) => table(x, rows).replace('y="0"', 'y="2000000"');
    const deck = memoryDeck(
      {
        "ppt/slides/slide1.xml": slide(
          title("Upgrade e incrementos") +
            encima("No le interesa", 0, 1500000) +
            tabla(0, [["Tipificación", "Cantidad", "%"], ["Algo", "1", "50%"], ["Total", "2", "100%"]]) +
            encima("No aplica", 6000000, 1500000) +
            tabla(6000000, [["Tipificación", "Cantidad", "%"], ["Otra cosa", "1", "50%"], ["Total", "2", "100%"]]),
        ),
      },
      {},
    );
    const conAplica = { ...upin, motivos: [...upin.motivos, { tipologia: "No aplica", subtipologia: "No labora", n: 7 }] };
    await llenarPresentacion(deck, { upin: conAplica }, { mesPlantilla: "2026-10" });
    const [interes, aplica] = readTables(deck.parts["ppt/slides/slide1.xml"]!);
    expect(interes!.cells.at(-1)).toEqual(["Total", "1000", "100%"]);
    expect(aplica!.cells.slice(1)).toEqual([["No labora", "7", "100%"], ["Total", "7", "100%"]]);
  });
});
