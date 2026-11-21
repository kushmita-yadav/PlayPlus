export const bookingTimes = ["18:00", "18:30", "19:00", "19:30", "20:00"];

export function isSlotBooked(bookings, courtId, date, time) {
  const [hour, minute] = time.split(":").map(Number);
  const slotStart = hour * 60 + minute;
  return bookings.some((booking) => {
    if (booking.courtId !== courtId || booking.date !== date ||
        ["cancelled", "rejected"].includes(String(booking.status || "confirmed").toLowerCase())) {
      return false;
    }
    const [bookedHour, bookedMinute] = booking.time.split(":").map(Number);
    const bookedStart = bookedHour * 60 + bookedMinute;
    const bookedEnd = bookedStart + (booking.durationMinutes || 60);
    return slotStart < bookedEnd && bookedStart < slotStart + 60;
  });
}

export function firstAvailableBookingTime(bookings, courtId, date, preferredTime, times = bookingTimes) {
  if (preferredTime && times.includes(preferredTime) &&
      !isSlotBooked(bookings, courtId, date, preferredTime)) {
    return preferredTime;
  }
  return times.find((time) => !isSlotBooked(bookings, courtId, date, time)) || "";
}
