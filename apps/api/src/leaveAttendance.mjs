export function parseDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date
    : null;
}

export function calculateDurationMinutes(start, end) {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  return Math.floor((endMs - startMs) / 60_000);
}

export function mapAttendanceRecord(row, locationName) {
  return {
    id: String(row.id),
    depotName: String(row.location_name ?? locationName ?? "Unknown worksite"),
    driverName: String(row.driver_name ?? "Driver"),
    vehicleRego: String(row.vehicle_rego ?? ""),
    checkinTime: String(row.signin_at),
    checkoutTime: row.signout_at ? String(row.signout_at) : null,
    hoursDrivenToday: Number(row.hours_driven_today ?? 0),
    hoursRestedLast24h: Number(row.hours_rested_last_24h ?? 0),
    fitnessDeclaration: Boolean(row.fitness_declaration),
    status: row.status === "signed_in" ? "Active" : "Checked Out"
  };
}
