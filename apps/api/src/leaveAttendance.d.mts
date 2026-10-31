export function parseDateOnly(value: string): Date | null;
export function calculateDurationMinutes(start: string, end: string): number | null;
export function mapAttendanceRecord(
  row: Record<string, unknown>,
  locationName?: string
): {
  id: string;
  depotName: string;
  driverName: string;
  vehicleRego: string;
  checkinTime: string;
  checkoutTime: string | null;
  hoursDrivenToday: number;
  hoursRestedLast24h: number;
  fitnessDeclaration: boolean;
  status: "Active" | "Checked Out";
};
