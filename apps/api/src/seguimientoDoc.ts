/* Seguimiento de documentación (TDC): la cola de trabajo sale de la sábana vigente más reciente
   (subetapas de seguimiento y productivas), con las llamadas de VICI hechas después de la venta
   y la gestión (STATUS homologado + comentario) que se registra en el CRM. */
import {
  DEPARTAMENTOS_SV,
  HORARIOS_CITA,
  LUGARES_ENTREGA,
  departamentoSV,
  esStatusDocumentacion,
  grupoDocumentacion,
  lugarEntregaCita,
  matchKey,
  toquesDespuesDeVenta,
  type GrupoDocumentacion,
} from "@crm/core";
import { audit } from "./audit";
import { contactFrom, parseExtra } from "./clientes";
import { HttpError, json, readJson, type Router } from "./http";

const CAMPAIGN = "tdc";
const MAX_COMENTARIO = 1000;
const DAY = /^20\d{2}-\d{2}-\d{2}$/;
const MAX_DIRECCION = 300;
const MAX_COMENTARIO_CITA = 500;
/** El Salvador no cambia de horario: UTC-6 todo el año. */
const hoySV = (ms = Date.now()) => new Date(ms - 6 * 3_600_000).toISOString().slice(0, 10);

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
  /** Documento recibido: la venta sale de la cola de trabajo. */
  recibido: { por: string; fecha: number } | null;
  /** Departamento de la sábana (para la cita). */
  departamento: string | null;
  citas: CitaDocumentacion[];
}

/** Cita de entrega: una fila del archivo VISITA TDC. */
export interface CitaDocumentacion {
  id: number;
  niu: string;
  venta: string;
  /** FECHA GESTION (día en que se agendó, hora de El Salvador). */
  fechaGestion: string;
  cliente: string | null;
  telefono: string;
  departamento: string;
  /** LUGAR ENTREGA tal como va en el archivo: RESIDENCIA/CUSCATLAN. */
  lugarEntrega: string;
  direccion: string;
  fechaCita: string;
  hora: string;
  comentario: string | null;
  por: string;
  fecha: number;
}

interface CitaRow {
  id: number;
  niu: string;
  sale_date: string;
  managed_on: string;
  client_name: string | null;
  phone: string;
  department: string;
  place: string;
  address: string;
  appointment_on: string;
  time_slot: string;
  comment: string | null;
  created_by: string;
  created_at: number;
}
const CITA_COLS = "id, niu, sale_date, managed_on, client_name, phone, department, place, address, appointment_on, time_slot, comment, created_by, created_at";
const cita = (r: CitaRow): CitaDocumentacion => ({
  id: r.id,
  niu: r.niu,
  venta: r.sale_date,
  fechaGestion: r.managed_on,
  cliente: r.client_name,
  telefono: r.phone,
  departamento: r.department,
  lugarEntrega: r.place,
  direccion: r.address,
  fechaCita: r.appointment_on,
  hora: r.time_slot,
  comentario: r.comment,
  por: r.created_by,
  fecha: r.created_at,
});

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

/** Solo el dueño del CRM (el usuario que lo configuró: el primero creado) puede eliminar comentarios. */
async function esDueno(env: { DB: D1Database }, userId: number): Promise<boolean> {
  const r = await env.DB.prepare("SELECT MIN(id) AS id FROM users").first<{ id: number | null }>();
  return r?.id === userId;
}

export function registerSeguimientoDoc(r: Router): void {
  r.on("GET", "/seguimiento-documentacion", "datos:ver", async ({ env, user }) => {
    const puedeEliminar = await esDueno(env, user.id);
    const sab = await env.DB.prepare(
      `SELECT id, month, file_name, created_at FROM uploads WHERE campaign = ? AND kind = 'sabana' AND is_current = 1 ORDER BY month DESC LIMIT 1`,
    )
      .bind(CAMPAIGN)
      .first<{ id: string; month: string; file_name: string; created_at: number }>();
    const { results: todas } = await env.DB.prepare(
      "SELECT id, niu, sale_date, status, comment, created_by, created_at FROM doc_followup_notes WHERE campaign = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 20000",
    )
      .bind(CAMPAIGN)
      .all<NotaRow>();
    const notas = todas.map(nota);
    const { results: citaRows } = await env.DB.prepare(
      `SELECT ${CITA_COLS} FROM doc_followup_appointments WHERE campaign = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 20000`,
    )
      .bind(CAMPAIGN)
      .all<CitaRow>();
    const citas = citaRows.map(cita);
    if (!sab) return json({ ok: true, puedeEliminar, sabana: null, filas: [], historial: notas.map((n) => ({ ...n, nombre: null, subetapa: null })), citas });

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

    const { results: rec } = await env.DB.prepare(
      "SELECT niu, sale_date, received_by, received_at FROM doc_followup_received WHERE campaign = ? AND undone_at IS NULL ORDER BY received_at DESC",
    )
      .bind(CAMPAIGN)
      .all<{ niu: string; sale_date: string; received_by: string; received_at: number }>();
    const recibidos = new Map<string, { por: string; fecha: number }>();
    for (const x of rec) if (!recibidos.has(llave(x.niu, x.sale_date))) recibidos.set(llave(x.niu, x.sale_date), { por: x.received_by, fecha: x.received_at });

    const citasDe = new Map<string, CitaDocumentacion[]>();
    for (const c of citas) (citasDe.get(llave(c.niu, c.venta)) ?? citasDe.set(llave(c.niu, c.venta), []).get(llave(c.niu, c.venta))!).push(c);

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
        recibido: recibidos.get(llave(v.niu, v.sale_date)) ?? null,
        departamento: departamentoSV(col(e, "Departamento")),
        citas: citasDe.get(llave(v.niu, v.sale_date)) ?? [],
      };
    });

    const historial = notas.map((n) => ({ ...n, ...(actual.get(llave(n.niu, n.venta)) ?? actual.get(llave(n.niu, null)) ?? { nombre: null, subetapa: null }) }));
    return json({ ok: true, puedeEliminar, sabana: { month: sab.month, archivo: sab.file_name, cargada: sab.created_at, corte }, filas, historial, citas });
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

  r.on("POST", "/seguimiento-documentacion/notas/:id/eliminar", "datos:cargar", async ({ env, params, user }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(404, "Ese comentario no existe.");
    if (!(await esDueno(env, user.id))) throw new HttpError(403, "Solo el dueño del CRM puede eliminar comentarios.");
    const res = await env.DB.prepare("UPDATE doc_followup_notes SET deleted_at = ?, deleted_by = ? WHERE id = ? AND campaign = ? AND deleted_at IS NULL")
      .bind(Date.now(), user.displayName, id, CAMPAIGN)
      .run();
    if (!res.meta.changes) throw new HttpError(404, "Ese comentario no existe o ya se eliminó.");
    await audit(env, user.username, "seguimiento_documentacion_eliminada", `${CAMPAIGN}:seguimiento-documentacion`, { id });
    return json({ ok: true });
  });

  r.on("POST", "/seguimiento-documentacion/recibido", "datos:cargar", async ({ env, req, user }) => {
    const body = await readJson(req);
    const niu = typeof body.niu === "string" ? body.niu.replace(/[\s.-]/g, "").replace(/^0+(?=\d)/, "") : "";
    if (!/^\d{1,30}$/.test(niu)) throw new HttpError(400, "NIU inválido.");
    const venta = typeof body.venta === "string" ? body.venta.trim() : "";
    if (venta && !DAY.test(venta)) throw new HttpError(400, "Fecha de venta inválida.");
    if (typeof body.recibido !== "boolean") throw new HttpError(400, "Indica si el documento se recibió.");
    const ahora = Date.now();
    if (body.recibido) {
      const existe = await env.DB.prepare(
        `SELECT 1 FROM bank_sales WHERE campaign = ? AND niu = ? AND COALESCE(sale_date, '') = ?
           AND upload_id IN (SELECT id FROM uploads WHERE campaign = ? AND kind = 'sabana' AND is_current = 1) LIMIT 1`,
      )
        .bind(CAMPAIGN, niu, venta, CAMPAIGN)
        .first();
      if (!existe) throw new HttpError(404, "Esa venta no está en la sábana vigente.");
      const ya = await env.DB.prepare("SELECT received_by, received_at FROM doc_followup_received WHERE campaign = ? AND niu = ? AND sale_date = ? AND undone_at IS NULL LIMIT 1")
        .bind(CAMPAIGN, niu, venta)
        .first<{ received_by: string; received_at: number }>();
      if (ya) return json({ ok: true, recibido: { por: ya.received_by, fecha: ya.received_at } });
      await env.DB.prepare("INSERT INTO doc_followup_received (campaign, niu, sale_date, received_by, received_at) VALUES (?, ?, ?, ?, ?)")
        .bind(CAMPAIGN, niu, venta, user.displayName, ahora)
        .run();
      await audit(env, user.username, "seguimiento_documentacion_recibido", `${CAMPAIGN}:seguimiento-documentacion`, {});
      return json({ ok: true, recibido: { por: user.displayName, fecha: ahora } });
    }
    await env.DB.prepare("UPDATE doc_followup_received SET undone_at = ?, undone_by = ? WHERE campaign = ? AND niu = ? AND sale_date = ? AND undone_at IS NULL")
      .bind(ahora, user.displayName, CAMPAIGN, niu, venta)
      .run();
    await audit(env, user.username, "seguimiento_documentacion_no_recibido", `${CAMPAIGN}:seguimiento-documentacion`, {});
    return json({ ok: true, recibido: null });
  });

  /** Agenda la cita de entrega y registra la gestión con STATUS "SE REALIZA CITA". */
  r.on("POST", "/seguimiento-documentacion/citas", "datos:cargar", async ({ env, req, user }) => {
    const body = await readJson(req);
    const niu = typeof body.niu === "string" ? body.niu.replace(/[\s.-]/g, "").replace(/^0+(?=\d)/, "") : "";
    if (!/^\d{1,30}$/.test(niu)) throw new HttpError(400, "NIU inválido.");
    const venta = typeof body.venta === "string" ? body.venta.trim() : "";
    if (venta && !DAY.test(venta)) throw new HttpError(400, "Fecha de venta inválida.");
    const texto = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");
    const telefono = texto(body.telefono).replace(/[\s-]/g, "");
    if (!/^\+?\d{7,15}$/.test(telefono)) throw new HttpError(400, "Escribe un teléfono válido.");
    const departamento = texto(body.departamento);
    if (!(DEPARTAMENTOS_SV as readonly string[]).includes(departamento)) throw new HttpError(400, "Elige el departamento.");
    const lugar = texto(body.lugar);
    if (!(LUGARES_ENTREGA as readonly string[]).includes(lugar)) throw new HttpError(400, "Elige el lugar de entrega.");
    const direccion = texto(body.direccion).toUpperCase();
    if (!direccion) throw new HttpError(400, "Escribe la dirección.");
    if (direccion.length > MAX_DIRECCION) throw new HttpError(400, `La dirección no puede pasar de ${MAX_DIRECCION} caracteres.`);
    const ahora = Date.now();
    const hoy = hoySV(ahora);
    const fechaCita = texto(body.fechaCita);
    if (!DAY.test(fechaCita)) throw new HttpError(400, "Elige la fecha de la cita.");
    if (fechaCita < hoy) throw new HttpError(400, "La fecha de la cita no puede ser anterior a hoy.");
    const hora = texto(body.hora);
    if (!(HORARIOS_CITA as readonly string[]).includes(hora)) throw new HttpError(400, "Elige la hora.");
    const comentarioCita = texto(body.comentarioCita).toUpperCase();
    if (comentarioCita.length > MAX_COMENTARIO_CITA) throw new HttpError(400, `El comentario de la cita no puede pasar de ${MAX_COMENTARIO_CITA} caracteres.`);
    const comentario = texto(body.comentario);
    if (comentario.length > MAX_COMENTARIO) throw new HttpError(400, `El comentario no puede pasar de ${MAX_COMENTARIO} caracteres.`);

    const venta0 = await env.DB.prepare(
      `SELECT extra FROM bank_sales WHERE campaign = ? AND niu = ? AND COALESCE(sale_date, '') = ?
         AND upload_id IN (SELECT id FROM uploads WHERE campaign = ? AND kind = 'sabana' AND is_current = 1) LIMIT 1`,
    )
      .bind(CAMPAIGN, niu, venta, CAMPAIGN)
      .first<{ extra: string | null }>();
    if (!venta0) throw new HttpError(404, "Esa venta no está en la sábana vigente.");
    const cliente = contactFrom(parseExtra(venta0.extra)).nombre;

    const [n, c] = await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO doc_followup_notes (campaign, niu, sale_date, status, comment, created_by, created_at) VALUES (?, ?, ?, 'SE REALIZA CITA', ?, ?, ?) RETURNING id, niu, sale_date, status, comment, created_by, created_at",
      ).bind(CAMPAIGN, niu, venta, comentario || null, user.displayName, ahora),
      env.DB.prepare(
        `INSERT INTO doc_followup_appointments (campaign, niu, sale_date, managed_on, client_name, phone, department, place, address, appointment_on, time_slot, comment, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${CITA_COLS}`,
      ).bind(CAMPAIGN, niu, venta, hoy, cliente, telefono, departamento, lugarEntregaCita(lugar, departamento), direccion, fechaCita, hora, comentarioCita || null, user.displayName, ahora),
    ]);
    await audit(env, user.username, "seguimiento_documentacion_cita", `${CAMPAIGN}:seguimiento-documentacion`, { fechaCita });
    return json({ ok: true, nota: nota((n!.results as NotaRow[])[0]!), cita: cita((c!.results as CitaRow[])[0]!) }, 201);
  });

  r.on("POST", "/seguimiento-documentacion/citas/:id/eliminar", "datos:cargar", async ({ env, params, user }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(404, "Esa cita no existe.");
    if (!(await esDueno(env, user.id))) throw new HttpError(403, "Solo el dueño del CRM puede eliminar citas.");
    const res = await env.DB.prepare("UPDATE doc_followup_appointments SET deleted_at = ?, deleted_by = ? WHERE id = ? AND campaign = ? AND deleted_at IS NULL")
      .bind(Date.now(), user.displayName, id, CAMPAIGN)
      .run();
    if (!res.meta.changes) throw new HttpError(404, "Esa cita no existe o ya se eliminó.");
    await audit(env, user.username, "seguimiento_documentacion_cita_eliminada", `${CAMPAIGN}:seguimiento-documentacion`, { id });
    return json({ ok: true });
  });
}
