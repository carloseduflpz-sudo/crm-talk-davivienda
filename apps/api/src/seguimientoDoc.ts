/* Seguimiento de documentación (TDC): la cola de trabajo sale de la sábana vigente más reciente
   (subetapas de seguimiento y productivas), con las llamadas de VICI hechas después de la venta
   y la gestión (STATUS homologado + comentario) que se registra en el CRM. */
import { esStatusDocumentacion, grupoDocumentacion, matchKey, toquesDespuesDeVenta, type GrupoDocumentacion } from "@crm/core";
import { audit } from "./audit";
import { contactFrom, parseExtra } from "./clientes";
import { HttpError, json, readJson, type Router } from "./http";

const CAMPAIGN = "tdc";
const MAX_COMENTARIO = 1000;
const DAY = /^20\d{2}-\d{2}-\d{2}$/;

type Extra = Record<string, unknown>;

/** Valor de una columna de la sábana, sin importar tildes o mayúsculas del encabezado. */
function col(e: Extra, ...names: string[]): string | null {
  const idx = new Map(Object.keys(e).map((k) => [matchKey(k), k]));
  for (const n of names) {
    const k = idx.get(matchKey(n));
    const v = k === undefined ? null : e[k];
    if (v !== null && v !== undefined && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

export interface NotaDocumentacion {
  id: number;
  niu: string;
  venta: string;
  status: string;
  comentario: string | null;
  por: string;
  fecha: number;
}

export interface FilaDocumentacion {
  id: number;
  grupo: GrupoDocumentacion;
  niu: string;
  venta: string | null;
  nombre: string | null;
  digitos: string | null;
  requisito: string | null;
  subetapa: string | null;
  etapa: string | null;
  detalle: string | null;
  motivo: string | null;
  telefono: string | null;
  ejecutivo: string | null;
  llamadas: number;
  dias: number;
  ultimaLlamada: string | null;
  tipificacion: string | null;
  notas: NotaDocumentacion[];
}

interface NotaRow {
  id: number;
  niu: string;
  sale_date: string;
  status: string;
  comment: string | null;
  created_by: string;
  created_at: number;
}
const nota = (r: NotaRow): NotaDocumentacion => ({ id: r.id, niu: r.niu, venta: r.sale_date, status: r.status, comentario: r.comment, por: r.created_by, fecha: r.created_at });
const llave = (niu: string, venta: string | null) => `${niu}|${venta ?? ""}`;

export function registerSeguimientoDoc(r: Router): void {
  r.on("GET", "/seguimiento-documentacion", "datos:ver", async ({ env }) => {
    const sab = await env.DB.prepare(
      `SELECT id, month, file_name, created_at FROM uploads WHERE campaign = ? AND kind = 'sabana' AND is_current = 1 ORDER BY month DESC LIMIT 1`,
    )
      .bind(CAMPAIGN)
      .first<{ id: string; month: string; file_name: string; created_at: number }>();
    const { results: todas } = await env.DB.prepare(
      "SELECT id, niu, sale_date, status, comment, created_by, created_at FROM doc_followup_notes WHERE campaign = ? ORDER BY created_at DESC, id DESC LIMIT 20000",
    )
      .bind(CAMPAIGN)
      .all<NotaRow>();
    const notas = todas.map(nota);
    if (!sab) return json({ ok: true, sabana: null, filas: [], historial: notas.map((n) => ({ ...n, nombre: null, subetapa: null })) });

    const { results: ventas } = await env.DB.prepare("SELECT id, niu, sale_date, executive, status_raw, extra FROM bank_sales WHERE upload_id = ? ORDER BY sale_date, niu, id")
      .bind(sab.id)
      .all<{ id: number; niu: string; sale_date: string | null; executive: string | null; status_raw: string | null; extra: string | null }>();
    const corte = ventas.reduce<string | null>((m, v) => (v.sale_date && (!m || v.sale_date > m) ? v.sale_date : m), null);

    // Lo que hoy dice la sábana de cada cliente (también de los que ya salieron de la cola): para el historial.
    const actual = new Map<string, { nombre: string | null; subetapa: string | null }>();
    const cola = ventas.flatMap((v) => {
      const e = parseExtra(v.extra);
      const nombre = contactFrom(e).nombre;
      actual.set(llave(v.niu, v.sale_date), { nombre, subetapa: v.status_raw });
      if (!actual.has(llave(v.niu, null))) actual.set(llave(v.niu, null), { nombre, subetapa: v.status_raw });
      const grupo = grupoDocumentacion(v.status_raw);
      return grupo ? [{ v, e, grupo, nombre }] : [];
    });

    // Llamadas de VICI de los clientes de la cola (todas las cargas vigentes de tipificaciones).
    const nius = [...new Set(cola.map((c) => c.v.niu))];
    const { results: calls } = nius.length
      ? await env.DB.prepare(
          `SELECT niu, called_at, tipologia FROM calls
           WHERE campaign = ? AND upload_id IN (SELECT id FROM uploads WHERE campaign = ? AND kind = 'tipif' AND is_current = 1)
             AND niu IN (SELECT value FROM json_each(?))`,
        )
          .bind(CAMPAIGN, CAMPAIGN, JSON.stringify(nius))
          .all<{ niu: string; called_at: string | null; tipologia: string | null }>()
      : { results: [] as { niu: string; called_at: string | null; tipologia: string | null }[] };
    const porNiu = new Map<string, { fecha: string | null; tipologia: string | null }[]>();
    for (const c of calls) (porNiu.get(c.niu) ?? porNiu.set(c.niu, []).get(c.niu)!).push({ fecha: c.called_at, tipologia: c.tipologia });

    const notasDe = new Map<string, NotaDocumentacion[]>();
    for (const n of notas) (notasDe.get(llave(n.niu, n.venta)) ?? notasDe.set(llave(n.niu, n.venta), []).get(llave(n.niu, n.venta))!).push(n);

    const filas: FilaDocumentacion[] = cola.map(({ v, e, grupo, nombre }) => {
      const t = toquesDespuesDeVenta(v.sale_date, porNiu.get(v.niu) ?? []);
      return {
        id: v.id,
        grupo,
        niu: v.niu,
        venta: v.sale_date,
        nombre,
        digitos: col(e, "DIGITOS"),
        requisito: col(e, "PENDIENTE POR REQUISITO"),
        subetapa: v.status_raw,
        etapa: col(e, "ETAPA PRIMARIA"),
        detalle: col(e, "DETALLE DE LA DEVOLUCIÓN"),
        motivo: col(e, "MOTIVO DEVOLUCION/OBSERVACIONES EXTRARREQUISITO/COMENTARIO GENERAL"),
        telefono: col(e, "TEL. VENTA REALIZADA", "CELULAR CLIENTE") ?? contactFrom(e).telefono,
        ejecutivo: v.executive,
        llamadas: t.llamadas,
        dias: t.dias,
        ultimaLlamada: t.ultima,
        tipificacion: t.tipificacion,
        notas: notasDe.get(llave(v.niu, v.sale_date)) ?? [],
      };
    });

    const historial = notas.map((n) => ({ ...n, ...(actual.get(llave(n.niu, n.venta)) ?? actual.get(llave(n.niu, null)) ?? { nombre: null, subetapa: null }) }));
    return json({ ok: true, sabana: { month: sab.month, archivo: sab.file_name, cargada: sab.created_at, corte }, filas, historial });
  });

  r.on("POST", "/seguimiento-documentacion/notas", "datos:cargar", async ({ env, req, user }) => {
    const body = await readJson(req);
    const niu = typeof body.niu === "string" ? body.niu.replace(/[\s.-]/g, "").replace(/^0+(?=\d)/, "") : "";
    if (!/^\d{1,30}$/.test(niu)) throw new HttpError(400, "NIU inválido.");
    const venta = typeof body.venta === "string" ? body.venta.trim() : "";
    if (venta && !DAY.test(venta)) throw new HttpError(400, "Fecha de venta inválida.");
    if (!esStatusDocumentacion(body.status)) throw new HttpError(400, "Elige un STATUS de la lista.");
    const comentario = typeof body.comentario === "string" ? body.comentario.trim().replace(/\s+/g, " ") : "";
    if (comentario.length > MAX_COMENTARIO) throw new HttpError(400, `El comentario no puede pasar de ${MAX_COMENTARIO} caracteres.`);

    const existe = await env.DB.prepare(
      `SELECT 1 FROM bank_sales WHERE campaign = ? AND niu = ? AND COALESCE(sale_date, '') = ?
         AND upload_id IN (SELECT id FROM uploads WHERE campaign = ? AND kind = 'sabana' AND is_current = 1) LIMIT 1`,
    )
      .bind(CAMPAIGN, niu, venta, CAMPAIGN)
      .first();
    if (!existe) throw new HttpError(404, "Esa venta no está en la sábana vigente.");

    const row = await env.DB.prepare(
      "INSERT INTO doc_followup_notes (campaign, niu, sale_date, status, comment, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id, niu, sale_date, status, comment, created_by, created_at",
    )
      .bind(CAMPAIGN, niu, venta, body.status, comentario || null, user.displayName, Date.now())
      .first<NotaRow>();
    await audit(env, user.username, "seguimiento_documentacion_gestion", `${CAMPAIGN}:seguimiento-documentacion`, { status: body.status });
    return json({ ok: true, nota: nota(row!) }, 201);
  });
}
