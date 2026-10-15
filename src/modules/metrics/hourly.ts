/** Pedidos por hora del día (0–23, hora de Lima): las 24 horas, aunque en alguna no haya pedidos. */
export function fillHours(rows: { hour: number; orders: number }[]): number[] {
  const hours = Array.from({ length: 24 }, () => 0);
  for (const r of rows) if (r.hour >= 0 && r.hour < 24) hours[r.hour] += Number(r.orders) || 0;
  return hours;
}
