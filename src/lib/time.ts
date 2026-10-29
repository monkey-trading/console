/** Clock text from a millisecond stamp, in UTC, so the server and the browser agree. */

const pad = (n: number) => String(n).padStart(2, "0");

/** `HH:MM:SS` in UTC. */
export function formatClock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const day = ((seconds % 86_400) + 86_400) % 86_400;
  return `${pad(Math.floor(day / 3600))}:${pad(Math.floor((day % 3600) / 60))}:${pad(day % 60)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** `28 Oct 15:04:05` in UTC. */
export function formatStamp(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  // Civil-from-days (Howard Hinnant), for the proleptic Gregorian calendar.
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return `${day} ${MONTHS[month - 1] ?? "?"} ${formatClock(ms)}`;
}
