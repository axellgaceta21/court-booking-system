import { useEffect, useMemo, useState } from "react";
import { apiUrl } from "./api";
import DatePickerInput from "./components/DatePickerInput";

const USER_BOOKING_REFRESH_MS = 15 * 1000;
const PENDING_PAYMENT_WINDOW_MS = 30 * 60 * 1000;

const TIME_SLOTS = [
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
  "19:00",
  "20:00",
  "21:00",
  "22:00",
  "23:00",
  "00:00",
  "01:00",
];

function getTodayLocalDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const emptyBookingForm = {
  name: "",
  email: "",
  mobile: "",
  date: getTodayLocalDate(),
  sport: "",
  court_id: "",
  start_time: "",
  end_time: "",
  waiver: false,
  payment_status: "Pending",
  notes: "",
};

export default function UserApp() {
  const [courts, setCourts] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loadingCourts, setLoadingCourts] = useState(true);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [form, setForm] = useState(emptyBookingForm);

  useEffect(() => {
    refreshReservationData();
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      loadBookings();
    }, USER_BOOKING_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const countdownIntervalId = window.setInterval(() => {
      setCurrentTime(Date.now());
    }, 30 * 1000);

    return () => window.clearInterval(countdownIntervalId);
  }, []);

  useEffect(() => {
    function handleWindowFocus() {
      refreshReservationData();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        refreshReservationData();
      }
    }

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!form.date || !form.court_id) return;
    loadBookings();
  }, [form.date, form.court_id]);

  async function loadCourts() {
    try {
      setLoadingCourts(true);
      const res = await fetch(apiUrl("/courts"));
      const data = await res.json();
      setCourts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Failed to load courts:", error);
      setCourts([]);
    } finally {
      setLoadingCourts(false);
    }
  }

  async function loadBookings() {
    try {
      const res = await fetch(apiUrl("/bookings"));
      const data = await res.json();
      const normalized = Array.isArray(data)
        ? data.map((booking) => ({
          ...booking,
          start_time: normalizeTime(booking.start_time),
          end_time: normalizeTime(booking.end_time),
        }))
        : [];
      setBookings(normalized);
    } catch (error) {
      console.error("Failed to load bookings:", error);
      setBookings([]);
    }
  }

  async function refreshReservationData() {
    await Promise.all([loadCourts(), loadBookings()]);
  }

  function normalizeTime(time) {
    if (!time) return "";
    return String(time).slice(0, 5);
  }

  function normalizeSport(value) {
    return String(value || "").trim().toLowerCase();
  }

  function isPendingPayment(status) {
    return String(status || "").trim().toLowerCase() === "pending";
  }

  function getBookingCreatedAtValue(booking) {
    return (
      booking?.created_at ||
      booking?.createdAt ||
      booking?.booked_at ||
      booking?.bookedAt ||
      booking?.inserted_at ||
      booking?.insertedAt ||
      ""
    );
  }

  function parseBookingTimestamp(value) {
    if (!value) {
      return Number.NaN;
    }

    const cleanValue = String(value).trim();
    const hasTimezone = /([zZ]|[+-]\d{2}:\d{2})$/.test(cleanValue);
    const normalizedValue = hasTimezone ? cleanValue : `${cleanValue}Z`;

    return new Date(normalizedValue).getTime();
  }

  function isExpiredPendingBooking(booking) {
    if (!isPendingPayment(booking?.payment_status)) {
      return false;
    }

    const createdAtValue = getBookingCreatedAtValue(booking);
    if (!createdAtValue) {
      return false;
    }

    const createdAtMs = parseBookingTimestamp(createdAtValue);
    if (Number.isNaN(createdAtMs)) {
      return false;
    }

    return currentTime - createdAtMs >= PENDING_PAYMENT_WINDOW_MS;
  }

  function getSlotIndex(time) {
    return TIME_SLOTS.indexOf(normalizeTime(time));
  }

  function formatTimeDisplay(time) {
    const clean = normalizeTime(time);
    const [hourStr, minute] = clean.split(":");
    let hour = Number(hourStr);
    const suffix = hour >= 12 ? "PM" : "AM";

    if (hour === 0) hour = 12;
    else if (hour > 12) hour -= 12;

    return `${hour}:${minute} ${suffix}`;
  }

  function calculateHours(start, end) {
    const startIndex = getSlotIndex(start);
    const endIndex = getSlotIndex(end);

    if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
      return 0;
    }

    return endIndex - startIndex;
  }

  function getRatePerHour(time) {
    const clean = normalizeTime(time);
    const hour = Number(clean.split(":")[0]);
    return hour >= 8 && hour < 12 ? 300 : 350;
  }

  function calculateMixedRate(start, end) {
    const startIndex = getSlotIndex(start);
    const endIndex = getSlotIndex(end);

    if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
      return 0;
    }

    let total = 0;
    for (let i = startIndex; i < endIndex; i++) {
      total += getRatePerHour(TIME_SLOTS[i]);
    }

    return total;
  }

  const formCourts = useMemo(() => {
    return courts.filter(
      (court) => normalizeSport(court.sport) === normalizeSport(form.sport)
    );
  }, [courts, form.sport]);

  const activeBookings = useMemo(() => {
    return bookings.filter((booking) => !isExpiredPendingBooking(booking));
  }, [bookings, currentTime]);

  const selectedCourtBookings = useMemo(() => {
    if (!form.date || !form.court_id) return [];

    return activeBookings.filter(
      (booking) =>
        String(booking.court_id) === String(form.court_id) &&
        booking.date === form.date
    );
  }, [activeBookings, form.court_id, form.date]);

  function isSlotTaken(slotTime) {
    const slotIndex = getSlotIndex(slotTime);

    return selectedCourtBookings.some((booking) => {
      const bookingStartIndex = getSlotIndex(booking.start_time);
      const bookingEndIndex = getSlotIndex(booking.end_time);
      return slotIndex >= bookingStartIndex && slotIndex < bookingEndIndex;
    });
  }

  const availableStartTimes = useMemo(() => {
    if (!form.date || !form.court_id) return [];
    return TIME_SLOTS.slice(0, -1).filter((time) => !isSlotTaken(time));
  }, [form.date, form.court_id, selectedCourtBookings]);

  const availableEndTimes = useMemo(() => {
    if (!form.start_time || !form.date || !form.court_id) return [];

    const startIndex = getSlotIndex(form.start_time);
    if (startIndex === -1) return [];

    const endTimes = [];

    for (let i = startIndex + 1; i < TIME_SLOTS.length; i++) {
      const currentSlot = TIME_SLOTS[i - 1];
      const nextEndTime = TIME_SLOTS[i];

      if (isSlotTaken(currentSlot)) {
        break;
      }

      endTimes.push(nextEndTime);
    }

    return endTimes;
  }, [form.start_time, form.date, form.court_id, selectedCourtBookings]);

  const totalHours = calculateHours(form.start_time, form.end_time);
  const totalRate = calculateMixedRate(form.start_time, form.end_time);

  function handleSportChange(value) {
    setForm((prev) => ({
      ...prev,
      sport: value,
      court_id: "",
      start_time: "",
      end_time: "",
    }));
  }

  function handleCourtChange(value) {
    setForm((prev) => ({
      ...prev,
      court_id: value,
      start_time: "",
      end_time: "",
    }));
  }

  function handleDateChange(value) {
    setForm((prev) => ({
      ...prev,
      date: value,
      start_time: "",
      end_time: "",
    }));
  }

  function handleStartTimeChange(value) {
    setForm((prev) => ({
      ...prev,
      start_time: value,
      end_time: "",
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (!form.waiver) {
      alert("Please accept the waiver and terms.");
      return;
    }

    if (!form.court_id || !form.date || !form.start_time || !form.end_time) {
      alert("Please complete the booking details.");
      return;
    }

    if (totalHours <= 0) {
      alert("End time must be later than start time.");
      return;
    }

    const bookingData = {
      court_id: Number(form.court_id),
      name: form.name,
      email: form.email,
      mobile: form.mobile,
      date: form.date,
      start_time: normalizeTime(form.start_time),
      end_time: normalizeTime(form.end_time),
      payment_status: form.payment_status,
      notes: form.notes,
    };

    const res = await fetch(apiUrl("/book"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bookingData),
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || "Booking failed");
      await loadBookings();
      return;
    }

    alert("Booking submitted successfully!");

    setForm({
      ...emptyBookingForm,
      sport: form.sport,
      date: form.date,
    });

    loadBookings();
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>🎾 RacketHub</h1><br />
        <p>Professional Court Booking Platform for Badminton & Pickleball</p>
      </header>

      <section className="booking-form-section user-only-form">
        <form className="booking-form" onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Full Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />

          <input
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />

          <input
            type="text"
            placeholder="Mobile Number"
            value={form.mobile}
            onChange={(e) => setForm({ ...form, mobile: e.target.value })}
            required
          />

          <DatePickerInput
            value={form.date}
            onChange={handleDateChange}
            minDate={getTodayLocalDate()}
            placeholder="Select a date"
          />

          <select
            value={form.sport}
            onChange={(e) => handleSportChange(e.target.value)}
            required
          >
            <option value="">Select Sports</option>
            <option value="Pickleball">Pickleball</option>
            <option value="Badminton">Badminton</option>
          </select>

          <select
            value={form.court_id}
            onChange={(e) => handleCourtChange(e.target.value)}
            required
            disabled={!form.sport || loadingCourts || formCourts.length === 0}
          >
            <option value="">
              {!form.sport
                ? "Select sport first"
                : loadingCourts
                  ? "Loading courts..."
                  : formCourts.length === 0
                    ? "No courts available"
                    : "Select Court"}
            </option>
            {formCourts.map((court) => (
              <option key={court.id} value={court.id}>
                {court.name}
              </option>
            ))}
          </select>

          <select
            value={form.start_time}
            onChange={(e) => handleStartTimeChange(e.target.value)}
            required
            disabled={!form.date || !form.court_id}
          >
            <option value="">
              {!form.date || !form.court_id
                ? "Select date and court first"
                : "Select Start Time"}
            </option>
            {availableStartTimes.map((time) => (
              <option key={time} value={time}>
                {formatTimeDisplay(time)}
              </option>
            ))}
          </select>

          <select
            value={form.end_time}
            onChange={(e) => setForm({ ...form, end_time: e.target.value })}
            required
            disabled={!form.start_time}
          >
            <option value="">
              {!form.start_time ? "Select start time first" : "Select End Time"}
            </option>
            {availableEndTimes.map((time) => (
              <option key={time} value={time}>
                {formatTimeDisplay(time)}
              </option>
            ))}
          </select>

          <select
            value={form.payment_status}
            onChange={(e) =>
              setForm({ ...form, payment_status: e.target.value })
            }
          >
            <option value="Pending">Payment Pending</option>
            <option value="Paid">Paid</option>
          </select>

          <textarea
            placeholder="Notes"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.waiver}
              onChange={(e) => setForm({ ...form, waiver: e.target.checked })}
            />
            I agree to the waiver, terms and conditions
          </label>

          <div className="summary-box">
            <p><strong>Total Hours:</strong> {totalHours}</p>
            <p><strong>Total Rate:</strong> ₱{totalRate}</p>
          </div>

          <button type="submit">Submit Booking</button>
        </form>
      </section><br /><br /><br />
      <button type="button" onClick={() => window.location.href = "/admin"}>Admin Login</button>
    </div>
  );
}
