/**
 * Episode publish dates, in the two shapes the site prints them.
 *
 * Plain functions for the two date formats the site prints (Vue 3 has no
 * filters).
 *
 * ⚠️ **Read in the visitor's local zone, deliberately.** The API sends UTC and
 * `core/` parses it into an instant; printing `getDate()` and friends gives
 * local time. Switching to UTC here would move a handful of the oldest episodes
 * by a day, and the printed dates must not change (root `CLAUDE.md`).
 *
 * ⚠️ Hand-rolled rather than `Intl.DateTimeFormat`, for the same reason: `Intl`
 * gives `12 de abril de 2009` in `es-ES` — lower-case month, and the locale is
 * the *browser's*, so an English visitor would get `April`. The site is Spanish
 * and its months are capitalised. The month table below is kept verbatim.
 */
export const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const;

/** The days, from Monday — the week the calendar's grids start on. */
export const WEEKDAY_NAMES = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'] as const;

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** `12/04/2009` — the compact form, used on the clip card's episode row. */
export function formatDate(date: Date): string {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** `12 de Abril de 2009` — the long form, used on the episode card. */
export function formatDateFull(date: Date): string {
  return `${pad(date.getDate())} de ${MONTH_NAMES[date.getMonth()]} de ${date.getFullYear()}`;
}

/**
 * `sáb 25 de Julio de 2011` — the long form with its weekday, for the calendar's
 * day panel.
 *
 * ⚠️ The weekday is lower-case against the month's capital, and that is the
 * site's own inconsistency rather than a slip: `MONTH_NAMES` is kept verbatim
 * and nothing may quietly restyle what the rest of the screens print.
 */
export function formatDayWithWeekday(date: Date): string {
  const weekday = WEEKDAY_NAMES[(date.getDay() + 6) % 7];
  return `${weekday} ${formatDateFull(date)}`;
}
