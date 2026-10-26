import { describe, expect, it } from "vitest";
import { chartTitle, fillChart, fillTable, findTable, readChart, readTables, replaceExactText, setChartTitle } from "./pptx";

const cell = (t: string, fill = "") =>
  `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="es-SV" sz="1100"><a:solidFill><a:srgbClr val="757171"/></a:solidFill></a:rPr><a:t>${t}</a:t></a:r></a:p></a:txBody><a:tcPr>${fill}</a:tcPr></a:tc>`;
const row = (cells: string[], fill = "") => `<a:tr h="100">${cells.map((c) => cell(c, fill)).join("")}</a:tr>`;
const slide = (rows: string) =>
  `<p:sld><p:cSld><p:spTree><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Tabla 4"/></p:nvGraphicFramePr><p:xfrm><a:off x="1" y="2"/><a:ext cx="300" cy="400"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="1"/><a:gridCol w="1"/></a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`;

describe("presentación: tablas", () => {
  const s = slide(row(["Mes", "Meta"]) + row(["Enero", "10"]) + row(["Febrero", "20"]) + row(["Total", "30"], '<a:solidFill><a:srgbClr val="FCE4D6"/></a:solidFill>'));

  it("lee y encuentra la tabla por su encabezado", () => {
    expect(readTables(s)[0]!.cells).toEqual([["Mes", "Meta"], ["Enero", "10"], ["Febrero", "20"], ["Total", "30"]]);
    expect(findTable(s, "mes meta")?.index).toBe(0);
  });

  it("agrega filas copiando el formato, conserva el total y ajusta el alto", () => {
    const out = fillTable(s, 0, { headerRows: 1, rows: [["Marzo", "1"], ["Abril", "2"], ["Mayo & Junio", "3"]], total: ["Total", "6"] });
    expect(readTables(out)[0]!.cells).toEqual([["Mes", "Meta"], ["Marzo", "1"], ["Abril", "2"], ["Mayo & Junio", "3"], ["Total", "6"]]);
    expect(out).toContain('cy="500"');
    expect(out.match(/srgbClr val="757171"/g)!.length).toBe(10); // cada celda conserva su color de letra
    expect(out.match(/FCE4D6/g)!.length).toBe(2); // el total conserva su relleno
    expect(out).toContain("Mayo &amp; Junio");
  });

  it("quita filas sobrantes y deja lo que no se da", () => {
    const out = fillTable(s, 0, { headerRows: 1, rows: [[undefined, "99"]] });
    expect(readTables(out)[0]!.cells).toEqual([["Mes", "Meta"], ["Enero", "99"]]);
  });
});

describe("presentación: gráficas y textos", () => {
  const chart = `<c:chartSpace><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:rPr sz="900"/><a:t>Conversión (prom. 6.5%)</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart><c:ser><c:idx val="0"/><c:tx><c:strRef><c:f>'[x.xlsx]UPIN'!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Upgrade</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:f>A</c:f><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>W 1</c:v></c:pt><c:pt idx="1"><c:v>W2</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>B</c:f><c:numCache><c:formatCode>0%</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>46</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>`;

  it("lee y cambia los datos guardados de la gráfica conservando el formato", () => {
    expect(readChart(chart)).toEqual([{ name: "Upgrade", categories: ["W 1", "W2"], values: [1, 46] }]);
    const out = fillChart(chart, [{ categories: ["W 1", "W2", "W 3"], values: [5, null, 7] }]);
    expect(readChart(out)).toEqual([{ name: "Upgrade", categories: ["W 1", "W2", "W 3"], values: [5, null, 7] }]);
    expect(out).toContain("<c:formatCode>0%</c:formatCode>");
    expect(out).toContain("<c:f>B</c:f>");
  });

  it("título y textos sueltos", () => {
    expect(chartTitle(chart)).toBe("Conversión (prom. 6.5%)");
    const t = setChartTitle(chart, "Conversión (prom. 7.1%)");
    expect(chartTitle(t)).toBe("Conversión (prom. 7.1%)");
    expect(t).toContain('<a:rPr sz="900"/>');
    expect(replaceExactText("<a:t>M</a:t><a:t>720</a:t>", "720", "750")).toEqual({ xml: "<a:t>M</a:t><a:t>750</a:t>", count: 1 });
  });
});
