// Shared helpers for the builder-operations views (warranty, job cost, payables, home
// sales, design center, land management, network orders, assignments, attention, time
// tracking, field inspections, integrations). Money is always integer minor units from the
// API; a null amount renders as "Not priced"/"Not entered" — never invented. The bilingual
// label dictionary covers the field views (time tracking + inspections); stored values are
// never translated, only the on-screen labels switch.

export function money(minor: number | null | undefined, currency = 'USD'): string {
  if (minor === null || minor === undefined) return 'Not entered';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100);
}

export function parseDollarsToMinor(value: string): number | null {
  const trimmed = value.trim().replace(/[$,]/g, '');
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function minorToDollarsInput(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '';
  return (minor / 100).toFixed(2);
}

export function prettyStatus(status: string): string {
  return status.replaceAll('_', ' ');
}

export function dateOnly(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.slice(0, 10);
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Honest email-state label used wherever something "sends" to another company. */
export function emailStateLabel(state: string): string {
  switch (state) {
    case 'sent':
      return 'Email sent';
    case 'queued':
      return 'Email queued';
    case 'failed':
      return 'Email failed';
    default:
      return 'Email not connected yet';
  }
}

// ---------------------------------------------------------------- bilingual labels

export type UiLang = 'en' | 'es';

export const FIELD_LABELS = {
  en: {
    timeTracking: 'Time tracking',
    recordTime: 'Record time',
    workerName: 'Worker name',
    job: 'Job',
    costCode: 'Cost code',
    workDate: 'Work date',
    hours: 'Hours',
    ratePerHour: 'Rate per hour ($)',
    laborCost: 'Labor cost',
    note: 'Note',
    save: 'Save',
    saving: 'Saving…',
    entries: 'Entries',
    rollup: 'Hours by cost code',
    totalHours: 'Total hours',
    totalLaborCost: 'Total labor cost',
    inspections: 'Field inspections',
    templates: 'Checklist templates',
    newTemplate: 'New template',
    templateName: 'Template name',
    items: 'Items (one per line)',
    startInspection: 'Start inspection',
    inspectorName: 'Inspector name',
    results: 'Inspections',
    pass: 'Pass',
    fail: 'Fail',
    na: 'N/A',
    complete: 'Complete inspection',
    inProgress: 'In progress',
    completed: 'Completed',
    language: 'Language',
    noEntries: 'No time entries yet.',
    noTemplates: 'No checklist templates yet.',
    noResults: 'No inspections yet.',
    fieldHome: 'Field',
    clockIn: 'Clock in',
    clockOut: 'Clock out',
    onTheClock: 'On the clock',
    clockedInAt: 'Clocked in at',
    elapsed: 'Elapsed',
    gpsOptional: 'Location is optional — recorded only if your phone shares it.',
    takePhoto: 'Take photo',
    photoQueued: 'Photo saved on this device — it will upload when you are back online.',
    photoUploaded: 'Photo uploaded.',
    runChecklist: 'Run checklist',
    assignmentsToAnswer: 'Work assigned to you',
    accept: 'Accept',
    decline: 'Decline',
    startWork: 'Start',
    completeWork: 'Complete',
    deliveries: 'Deliveries',
    markShipped: 'Mark shipped',
    markDelivered: 'Mark delivered',
    queuedNote: 'Saved on this device — will send when you are back online.',
    noAssignments: 'Nothing assigned to you right now.',
    noDeliveries: 'No deliveries in flight.',
    addNote: 'Add note',
    openInspections: 'Open inspections',
  },
  es: {
    timeTracking: 'Control de tiempo',
    recordTime: 'Registrar tiempo',
    workerName: 'Nombre del trabajador',
    job: 'Trabajo',
    costCode: 'Código de costo',
    workDate: 'Fecha de trabajo',
    hours: 'Horas',
    ratePerHour: 'Tarifa por hora ($)',
    laborCost: 'Costo de mano de obra',
    note: 'Nota',
    save: 'Guardar',
    saving: 'Guardando…',
    entries: 'Registros',
    rollup: 'Horas por código de costo',
    totalHours: 'Horas totales',
    totalLaborCost: 'Costo total de mano de obra',
    inspections: 'Inspecciones de campo',
    templates: 'Plantillas de listas de verificación',
    newTemplate: 'Nueva plantilla',
    templateName: 'Nombre de la plantilla',
    items: 'Elementos (uno por línea)',
    startInspection: 'Iniciar inspección',
    inspectorName: 'Nombre del inspector',
    results: 'Inspecciones',
    pass: 'Aprobado',
    fail: 'Falló',
    na: 'N/A',
    complete: 'Completar inspección',
    inProgress: 'En curso',
    completed: 'Completada',
    language: 'Idioma',
    noEntries: 'Aún no hay registros de tiempo.',
    noTemplates: 'Aún no hay plantillas.',
    noResults: 'Aún no hay inspecciones.',
    fieldHome: 'Campo',
    clockIn: 'Registrar entrada',
    clockOut: 'Registrar salida',
    onTheClock: 'En el reloj',
    clockedInAt: 'Entrada a las',
    elapsed: 'Tiempo transcurrido',
    gpsOptional: 'La ubicación es opcional: solo se registra si tu teléfono la comparte.',
    takePhoto: 'Tomar foto',
    photoQueued: 'Foto guardada en este dispositivo: se subirá cuando vuelvas a tener conexión.',
    photoUploaded: 'Foto subida.',
    runChecklist: 'Ejecutar lista',
    assignmentsToAnswer: 'Trabajo asignado a ti',
    accept: 'Aceptar',
    decline: 'Rechazar',
    startWork: 'Empezar',
    completeWork: 'Completar',
    deliveries: 'Entregas',
    markShipped: 'Marcar enviado',
    markDelivered: 'Marcar entregado',
    queuedNote: 'Guardado en este dispositivo: se enviará cuando vuelvas a tener conexión.',
    noAssignments: 'No tienes nada asignado por ahora.',
    noDeliveries: 'No hay entregas en curso.',
    addNote: 'Agregar nota',
    openInspections: 'Inspecciones abiertas',
  },
} as const;

export type FieldLabelKey = keyof (typeof FIELD_LABELS)['en'];

/** Initial field-view language from the device locale preference (Spanish when it starts with es). */
export function initialFieldLang(locale: string): UiLang {
  return locale.toLowerCase().startsWith('es') ? 'es' : 'en';
}
