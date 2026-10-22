import { describe, expect, it } from "vitest";
import {
  ALL_DATASETS,
  CAMPAIGNS,
  DEFAULT_TIPOLOGIAS,
  buildTipologiaIndex,
  can,
  classifyCall,
  classifySale,
  isEffectiveContact,
  normalizeNiu,
} from "./index";

describe("campañas", () => {
  it("son exactamente las 6 de Davivienda", () => {
    expect(CAMPAIGNS.map((c) => c.code)).toEqual(["tdc", "extrafin", "cdc", "upin", "seguros", "domi"]);
  });
  it("cada campaña carga sábana, al menos una base, tipificaciones y ventas", () => {
    for (const c of CAMPAIGNS) {
      const kinds = new Set(c.datasets.map((d) => d.kind));
      expect([...kinds].sort()).toEqual(["base", "sabana", "tipif", "ventas"]);
    }
  });
  it("los identificadores de datos no se repiten", () => {
    const ids = ALL_DATASETS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("estatus del banco", () => {
  it("clasifica sin importar tildes, mayúsculas ni espacios", () => {
    expect(classifySale("tdc", " entregada ")).toBe("aprobado");
    expect(classifySale("extrafin", "Devolución")).toBe("rechazado");
    expect(classifySale("seguros", "cancelado  por solicitud")).toBe("rechazado");
    expect(classifySale("domi", "EXITOSA")).toBe("aprobado");
  });
  it("lo que no es aprobado ni rechazado queda en proceso", () => {
    expect(classifySale("tdc", "EN ANALISIS")).toBe("en_proceso");
    expect(classifySale("upin", "")).toBe("en_proceso");
    expect(classifySale("cdc", null)).toBe("en_proceso");
  });
});

describe("tipologías", () => {
  const idx = buildTipologiaIndex(DEFAULT_TIPOLOGIAS);
  it("conserva las 143 tipologías homologadas de la versión 1", () => {
    expect(DEFAULT_TIPOLOGIAS.length).toBe(143);
  });
  it("usa la tipología homologada de la campaña", () => {
    expect(classifyCall(idx, "tdc", "Venta realizada", "")).toBe("venta");
    expect(classifyCall(idx, "domi", "acepta domiciliación", "")).toBe("venta");
    expect(classifyCall(idx, "seguros", "Contacto con un tercero", "")).toBe("negativo");
    expect(classifyCall(idx, "domi", "Contacto con un tercero", "")).toBe("no_efectivo");
  });
  it("si la tipología no está homologada usa la categoría de VICI", () => {
    expect(classifyCall(idx, "tdc", "Algo nuevo", "Contacto efectivo positivo")).toBe("venta");
    expect(classifyCall(idx, "tdc", "Algo nuevo", "No contacto")).toBe("no_contacto");
    expect(classifyCall(idx, "tdc", "Algo nuevo", "")).toBe("sin_tipificar");
  });
  it("la regla de contacto efectivo está en un solo lugar", () => {
    expect(isEffectiveContact("no_efectivo", "con_no_efectivo")).toBe(true);
    expect(isEffectiveContact("no_efectivo", "sin_no_efectivo")).toBe(false);
    expect(isEffectiveContact("no_contacto", "con_no_efectivo")).toBe(false);
  });
});

describe("NIU", () => {
  it("normaliza números de Excel", () => {
    expect(normalizeNiu("0012345")).toBe("12345");
    expect(normalizeNiu(12345)).toBe("12345");
    expect(normalizeNiu("12345.0")).toBe("12345");
    expect(normalizeNiu("1.2345e+4")).toBe("12345");
    expect(normalizeNiu("123-45 6")).toBe("123456");
  });
  it("rechaza lo que no es un NIU", () => {
    expect(normalizeNiu("NULL")).toBe("");
    expect(normalizeNiu("ABC123")).toBe("");
    expect(normalizeNiu(undefined)).toBe("");
  });
});

describe("roles", () => {
  it("admin puede todo; lector solo ver", () => {
    expect(can("admin", "datos:restaurar")).toBe(true);
    expect(can("lector", "datos:ver")).toBe(true);
    expect(can("lector", "datos:cargar")).toBe(false);
  });
});
