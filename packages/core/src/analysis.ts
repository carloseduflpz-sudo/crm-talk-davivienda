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
}

export interface MonthlySalesRow {
  month: string;
  ventas: number;
  aprobadas: number;
  rechazadas: number;
  enProceso: number;
  aprobacion: number;
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
  /** Archivos vigentes del mes elegido, por tipo. */
  loaded: { dataset: string; kind: string; rows: number; version: number; createdAt: number; createdBy: string }[];

  ventas: null | {
    total: number;
    aprobadas: number;
    rechazadas: number;
    enProceso: number;
    aprobacion: number;
    porEstatus: (Count & { class: string })[];
    porEjecutivo: SalesAgentRow[];
    rechazoPorMotivo: Count[];
    porDia: { date: string; ventas: number; aprobadas: number }[];
    porProceso: Count[];
    mensual: MonthlySalesRow[];
  };

  base: null | {
    total: number;
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
    /** Ventas que cuentan para la meta (solo los estatus de `config.estatus`). */
    ventas: number;
    /** Todas las ventas de la sábana del mes, cuenten o no. */
    ventasTotales: number;
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
    /** Ventas por día hábil. */
    ritmoDiario: number;
    proyeccion: number;
    ritmoNecesario: number | null;
    /** Lo que se esperaba llevar a la fecha de corte, repartiendo la meta por días hábiles. */
    esperado: number | null;
    porAgente: { agent: string; ventas: number; total: number; aprobadas: number; meta: number | null; gap: number | null; avance: number | null }[];
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
    estatusDisponibles: { label: string; value: number; cuenta: boolean }[];
    feriadosSugeridos: { date: string; name: string }[];
  };
}
