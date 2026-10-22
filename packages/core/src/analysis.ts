/* Forma de la respuesta de /api/analisis: compartida por la API y las pantallas. */

export interface Count {
  label: string;
  value: number;
}

export interface SalesAgentRow {
  agent: string;
  ventas: number;
  aprobadas: number;
  rechazadas: number;
  /** aprobadas ÷ (aprobadas + rechazadas), en %. */
  aprobacion: number;
  /** Suma del monto de la sábana (CDC, Extra, UPIN traen monto) y de lo aprobado. */
  monto: number;
  montoAprobado: number;
}

export interface MonthlySalesRow {
  month: string;
  ventas: number;
  aprobadas: number;
  rechazadas: number;
  enProceso: number;
  aprobacion: number;
  monto: number;
  montoAprobado: number;
}

export interface CallAgentRow {
  agent: string;
  llamadas: number;
  /** Clientes (NIU) distintos que llamó. */
  registros: number;
  efectivos: number;
  ventas: number;
  noContacto: number;
  /** efectivos ÷ llamadas, en %. */
  contactabilidad: number;
}

export interface ProfileRow {
  profile: string;
  base: number;
  conVenta: number;
  aprobadas: number;
  rechazadas: number;
  /** conVenta ÷ base, en %. */
  penetracion: number;
}

export interface CampaignAnalysis {
  campaign: string;
  month: string | null;
  /** Meses con al menos un archivo vigente, del más reciente al más antiguo. */
  months: string[];
  /** Agente por el que está filtrado el análisis (null = todos). La base no depende del agente. */
  agente: string | null;
  /** Agentes que aparecen en la sábana, VICI o el CRM del mes (para el filtro). */
  agentes: string[];
  /** Agentes cuyo nombre viene escrito de varias formas y la herramienta unió solo. */
  agentesUnidos: { nombre: string; variantes: string[] }[];
  /** Archivos vigentes del mes elegido, por tipo. */
  loaded: { dataset: string; kind: string; rows: number; version: number; createdAt: number; createdBy: string }[];
  /** Fechas de los datos del mes: hasta qué día llegan y si algún archivo trae filas con fecha de otro mes. */
  fechas: {
    /** Último día con datos dentro del mes (sábana, tipificaciones o CRM). */
    hasta: string | null;
    fuera: { kind: "sabana" | "tipif" | "ventas"; filas: number; meses: string[] }[];
  };

  ventas: null | {
    total: number;
    aprobadas: number;
    rechazadas: number;
    enProceso: number;
    aprobacion: number;
    /** Montos en dólares (0 si la sábana no trae monto). */
    monto: { total: number; aprobado: number; rechazado: number; enProceso: number };
    porEstatus: (Count & { class: string; monto: number })[];
    porEjecutivo: SalesAgentRow[];
    rechazoPorMotivo: (Count & { monto: number })[];
    porDia: { date: string; ventas: number; aprobadas: number; monto: number; montoAprobado: number }[];
    porProceso: Count[];
    mensual: MonthlySalesRow[];
    /** Cosecha: ventas de meses anteriores que trae la sábana de este mes (por fecha de venta). */
    cosecha: { total: number; monto: number; porMes: { month: string; ventas: number; monto: number }[] };
  };

  base: null | {
    total: number;
    /** Cada carga de base vigente del mes: la original y las adicionales, en orden de llegada.
        Los clientes que se repiten se atribuyen a la primera base que los trajo. */
    porCarga: {
      uploadId: string;
      dataset: string;
      adicional: boolean;
      nombre: string | null;
      llegada: number;
      registros: number;
      unicos: number;
      /** Clientes que no venían en una base anterior del mes. */
      nuevos: number;
      repetidos: number;
      /** De los clientes nuevos: cuántos se llamaron, cuántos tuvieron contacto efectivo y cuántos compraron. */
      llamados: number;
      contactados: number;
      ventas: number;
      aprobadas: number;
      /** Ventas ÷ clientes nuevos, en %. */
      penetracion: number;
    }[];
    porArchivo: { dataset: string; registros: number; unicos: number }[];
    porPerfil: ProfileRow[];
    historial: { month: string; dataset: string; unicos: number }[];
  };

  llamadas: null | {
    total: number;
    registros: number;
    efectivos: number;
    contactabilidad: number;
    /** Regla vigente para "contacto efectivo". */
    reglaContacto: "con_no_efectivo" | "sin_no_efectivo";
    porClase: Count[];
    porAgente: CallAgentRow[];
    tipologias: (Count & { class: string })[];
    porDia: { date: string; llamadas: number; efectivos: number }[];
    intentos: { intentos: string; clientes: number }[];
    primerContacto: number;
    seguimiento: number;
    ventasPrimerIntento: number;
    ventasRellamado: number;
    /** Clientes con venta en VICI ÷ base del mes, en %. Null si no hay base cargada. */
    penetracion: number | null;
    ventasUnicas: number;
  };

  crm: null | {
    total: number;
    conEstatusBanco: number | null;
    porAgente: Count[];
    porDia: { date: string; ventas: number }[];
  };

  cumplimiento: {
    meta: number | null;
    agentes: number | null;
    metaPorAgente: number | null;
    /** "ventas" = se mide en número de ventas; "monto" = en dólares (CDC y Extra). */
    unidad: "ventas" | "monto";
    /** Lo que cuenta para la meta (solo los estatus de `config.estatus`): ventas o dólares según `unidad`. */
    ventas: number;
    /** Lo mismo con todas las ventas de la sábana del mes, cuenten o no. */
    ventasTotales: number;
    /** Número de ventas que cuentan y total de la sábana (útil cuando la meta es en dólares). */
    operaciones: number;
    operacionesTotales: number;
    aprobadas: number;
    avance: number | null;
    faltan: number | null;
    /** Último día con ventas en la sábana: hasta ahí se mide el avance. */
    fechaCorte: string | null;
    /** Días hábiles transcurridos hasta la fecha de corte (incluida). */
    diaDelMes: number;
    /** Días hábiles del mes. */
    diasDelMes: number;
    diasRestantes: number;
    /** Ventas (o dólares) por día hábil. */
    ritmoDiario: number;
    proyeccion: number;
    ritmoNecesario: number | null;
    /** Meta MTD: lo que se esperaba llevar a la fecha de corte, repartiendo la meta por días hábiles. */
    esperado: number | null;
    /** Cumplimiento MTD: ventas ÷ meta MTD, en %. */
    avanceMTD: number | null;
    /**
     * Cosecha: de lo que cuenta para la meta, lo vendido en meses anteriores que el banco entregó, aplicó
     * o activó en este mes (ventas o dólares según `unidad`, y número de operaciones).
     */
    cosecha: { valor: number; operaciones: number; porMes: { month: string; valor: number; operaciones: number }[] };
    /** Ventas que ya contaron para la meta de un mes anterior: aparecen otra vez en la sábana pero no se repiten. */
    yaContadas: { valor: number; operaciones: number };
    porAgente: {
      agent: string;
      ventas: number;
      total: number;
      operaciones: number;
      aprobadas: number;
      /** Meta del mes del agente (meta ÷ HC). */
      meta: number | null;
      gap: number | null;
      avance: number | null;
      /** Meta MTD del agente y su cumplimiento a la fecha de corte. */
      metaMTD: number | null;
      gapMTD: number | null;
      avanceMTD: number | null;
    }[];
    /** Configuración de la meta del mes (o la sugerida si aún no hay meta). */
    config: {
      /** Estatus de la sábana que cuentan para la meta. */
      estatus: string[];
      /** true si se usa la regla por defecto (no se ha elegido a mano). */
      estatusPorDefecto: boolean;
      /** Días de la semana que se trabajan (0 = domingo … 6 = sábado). */
      diasSemana: number[];
      feriados: string[];
    };
    /** Estatus de la sábana del mes, con cuántas ventas tiene cada uno y si cuenta. */
    estatusDisponibles: { label: string; value: number; monto: number; cuenta: boolean }[];
    feriadosSugeridos: { date: string; name: string }[];
  };
}

/** Resumen de un mes para la pestaña Histórico (todos los meses con archivos vigentes). */
export interface MonthSummary {
  month: string;
  /** Ventas de la sábana (null si ese mes no tiene sábana). */
  ventas: number | null;
  aprobadas: number | null;
  rechazadas: number | null;
  aprobacion: number | null;
  monto: number | null;
  montoAprobado: number | null;
  /** Clientes únicos de la base (original + adicionales) y cuántas bases adicionales hubo. */
  base: number | null;
  adicionales: number;
  llamadas: number | null;
  registros: number | null;
  contactabilidad: number | null;
  ventasVici: number | null;
  penetracion: number | null;
  /** Meta del mes y lo que cuenta para ella (ventas o dólares según la campaña). */
  unidad: "ventas" | "monto";
  meta: number | null;
  logrado: number | null;
  cumplimiento: number | null;
  diasHabiles: number;
  /** Último día con datos dentro del mes (null si no hay archivos con fecha). */
  hasta: string | null;
  /** Ventas y monto de la sábana acumulados día a día (posición 0 = día 1): para comparar meses al mismo día. */
  acumulado: { ventas: number[]; monto: number[] };
}

