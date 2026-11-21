export interface Booking {
  courtId: string;
  date: string;
  time: string;
  status?: string;
  durationMinutes?: number;
}

export const bookingTimes: string[];
export function isSlotBooked(
  bookings: readonly Booking[],
  courtId: string,
  date: string,
  time: string,
): boolean;
export function firstAvailableBookingTime(
  bookings: readonly Booking[],
  courtId: string,
  date: string,
  preferredTime: string,
  times?: readonly string[],
): string;
