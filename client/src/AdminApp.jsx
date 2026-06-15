import { useEffect, useMemo, useState } from "react";
import { clearAdminToken, getAdminToken } from "./adminAuth";
import { apiUrl } from "./api";
import DatePickerInput from "./components/DatePickerInput";

const AUTO_REFRESH_MS = 5 * 60 * 1000;
const SLOT_CELL_MIN_HEIGHT = 72;
const TABLE_CELL_VERTICAL_PADDING = 12;
const TABLE_ROW_GAP = 10;
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
  sport: "Pickleball",
  court_id: "",
  start_time: "",
  end_time: "",
  waiver: true,
  payment_status: "Pending",
  notes: "",
};

const emptyCourtForm = {
  name: "",
  sport: "Pickleball",
};

export default function AdminApp() {
  const [courts, setCourts] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loadingCourts, setLoadingCourts] = useState(true);
  const [refreshingData, setRefreshingData] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [selectedSport, setSelectedSport] = useState("Pickleball");
  const [scheduleDate, setScheduleDate] = useState(getTodayLocalDate());
  const [adminBookingForm, setAdminBookingForm] = useState(emptyBookingForm);
  const [courtForm, setCourtForm] = useState(emptyCourtForm);
  const [editingBookingId, setEditingBookingId] = useState(null);

  useEffect(() => {
    validateAdminSession();
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      refreshDashboardData({ silent: true });
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, []);

  function getAuthorizedHeaders(extraHeaders = {}) {
    const token = getAdminToken();
    if (!token) return { ...extraHeaders };
    return {
      ...extraHeaders,
      Authorization: `Bearer ${token}`,
    };
  }

  function redirectToAdminLogin() {
    clearAdminToken();
    window.location.href = "/admin/login";
  }

  async function validateAdminSession() {
    // Admin authentication disabled for portfolio purposes
    // Skip token validation and directly load dashboard data
    refreshDashboardData();
  }

  useEffect(() => {
    const countdownIntervalId = window.setInterval(() => {
      setCurrentTime(Date.now());
    }, 30 * 1000);

    return () => window.clearInterval(countdownIntervalId);
  }, []);

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

  async function refreshDashboardData(options = {}) {
    const { silent = false } = options;

    if (!silent) {
      setRefreshingData(true);
    }

    try {
      await Promise.all([loadCourts(), loadBookings()]);
    } finally {
      if (!silent) {
        setRefreshingData(false);
      }
    }
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

  function getPendingMinutesLeft(booking) {
    if (!isPendingPayment(booking?.payment_status)) {
      return null;
    }

    const createdAtValue = getBookingCreatedAtValue(booking);
    if (!createdAtValue) {
      return null;
    }

    const createdAtMs = parseBookingTimestamp(createdAtValue);
    if (Number.isNaN(createdAtMs)) {
      return null;
    }

    const remainingMs = PENDING_PAYMENT_WINDOW_MS - (currentTime - createdAtMs);
    return Math.max(0, Math.ceil(remainingMs / (60 * 1000)));
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

  function formatBookingHoursLabel(hours) {
    const value = Number(hours) || 0;
    return `${value} ${value === 1 ? "Hour" : "Hours"}`;
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

  function getSelectedCourtBookings(currentForm, excludeBookingId = null) {
    if (!currentForm.date || !currentForm.court_id) return [];

    return activeBookings.filter((booking) => {
      const sameCourt =
        String(booking.court_id) === String(currentForm.court_id);
      const sameDate = booking.date === currentForm.date;
      const notExcluded =
        excludeBookingId == null ||
        Number(booking.id) !== Number(excludeBookingId);

      return sameCourt && sameDate && notExcluded;
    });
  }

  function isSlotTaken(slotTime, currentForm, excludeBookingId = null) {
    const slotIndex = getSlotIndex(slotTime);
    const selectedBookings = getSelectedCourtBookings(currentForm, excludeBookingId);

    return selectedBookings.some((booking) => {
      const bookingStartIndex = getSlotIndex(booking.start_time);
      const bookingEndIndex = getSlotIndex(booking.end_time);

      return slotIndex >= bookingStartIndex && slotIndex < bookingEndIndex;
    });
  }

  function getAvailableStartTimes(currentForm, excludeBookingId = null) {
    if (!currentForm.date || !currentForm.court_id) return [];
    return TIME_SLOTS.slice(0, -1).filter(
      (time) => !isSlotTaken(time, currentForm, excludeBookingId)
    );
  }

  function getAvailableEndTimes(currentForm, excludeBookingId = null) {
    if (!currentForm.start_time || !currentForm.date || !currentForm.court_id) {
      return [];
    }

    const startIndex = getSlotIndex(currentForm.start_time);
    if (startIndex === -1) return [];

    const endTimes = [];

    for (let i = startIndex + 1; i < TIME_SLOTS.length; i++) {
      const currentSlot = TIME_SLOTS[i - 1];
      const nextEndTime = TIME_SLOTS[i];

      if (isSlotTaken(currentSlot, currentForm, excludeBookingId)) {
        break;
      }

      endTimes.push(nextEndTime);
    }

    return endTimes;
  }

  function getBookingForCell(courtId, date, slotTime) {
    const slotIndex = getSlotIndex(slotTime);

    return activeBookings.find((booking) => {
      if (String(booking.court_id) !== String(courtId)) return false;
      if (booking.date !== date) return false;

      const bookingStartIndex = getSlotIndex(booking.start_time);
      const bookingEndIndex = getSlotIndex(booking.end_time);

      return slotIndex >= bookingStartIndex && slotIndex < bookingEndIndex;
    });
  }

  function getRowSpan(booking) {
    return calculateHours(booking.start_time, booking.end_time);
  }

  function getMergedBookingHeight(rowSpan) {
    if (rowSpan <= 0) return SLOT_CELL_MIN_HEIGHT;

    return (
      rowSpan * SLOT_CELL_MIN_HEIGHT +
      (rowSpan - 1) * (TABLE_CELL_VERTICAL_PADDING + TABLE_ROW_GAP)
    );
  }

  function formatDateHeading(dateStr) {
    if (!dateStr) return "";
    const date = new Date(`${dateStr}T00:00:00`);
    return date.toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  const scheduleCourts = useMemo(() => {
    return courts.filter(
      (court) => normalizeSport(court.sport) === normalizeSport(selectedSport)
    );
  }, [courts, selectedSport]);

  const activeBookings = useMemo(() => {
    return bookings.filter((booking) => !isExpiredPendingBooking(booking));
  }, [bookings, currentTime]);

  const adminFormCourts = useMemo(() => {
    return courts.filter(
      (court) =>
        normalizeSport(court.sport) === normalizeSport(adminBookingForm.sport)
    );
  }, [courts, adminBookingForm.sport]);

  const adminAvailableStartTimes = useMemo(() => {
    return getAvailableStartTimes(adminBookingForm, editingBookingId);
  }, [adminBookingForm, activeBookings, editingBookingId]);

  const adminAvailableEndTimes = useMemo(() => {
    return getAvailableEndTimes(adminBookingForm, editingBookingId);
  }, [adminBookingForm, activeBookings, editingBookingId]);

  const adminTotalHours = calculateHours(
    adminBookingForm.start_time,
    adminBookingForm.end_time
  );
  const adminTotalRate = calculateMixedRate(
    adminBookingForm.start_time,
    adminBookingForm.end_time
  );

  async function handleAdminBookingSubmit(e) {
    e.preventDefault();

    if (
      !adminBookingForm.name ||
      !adminBookingForm.email ||
      !adminBookingForm.mobile ||
      !adminBookingForm.date ||
      !adminBookingForm.court_id ||
      !adminBookingForm.start_time ||
      !adminBookingForm.end_time
    ) {
      alert("Please complete all admin booking fields.");
      return;
    }

    if (adminTotalHours <= 0) {
      alert("End time must be later than start time.");
      return;
    }

    const payload = {
      court_id: Number(adminBookingForm.court_id),
      name: adminBookingForm.name,
      email: adminBookingForm.email,
      mobile: adminBookingForm.mobile,
      date: adminBookingForm.date,
      start_time: normalizeTime(adminBookingForm.start_time),
      end_time: normalizeTime(adminBookingForm.end_time),
      payment_status: adminBookingForm.payment_status,
      notes: adminBookingForm.notes,
    };

    const url = editingBookingId
      ? apiUrl(`/bookings/${editingBookingId}`)
      : apiUrl("/book");

    const method = editingBookingId ? "PUT" : "POST";
    const headers = editingBookingId
      ? getAuthorizedHeaders({
          "Content-Type": "application/json",
        })
      : {
          "Content-Type": "application/json",
        };

    const res = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 401) {
        redirectToAdminLogin();
        return;
      }
      alert(data.error || "Admin booking action failed.");
      await loadBookings();
      return;
    }

    alert(editingBookingId ? "Booking updated successfully!" : "Booking added successfully!");
    setAdminBookingForm({
      ...emptyBookingForm,
      date: getTodayLocalDate(),
      sport: "Pickleball",
    });
    setEditingBookingId(null);
    loadBookings();
  }

  async function handleAddCourt(e) {
    e.preventDefault();

    if (!courtForm.name || !courtForm.sport) {
      alert("Please enter court name and sport.");
      return;
    }

    const res = await fetch(apiUrl("/courts"), {
      method: "POST",
      headers: {
        ...getAuthorizedHeaders({
          "Content-Type": "application/json",
        }),
      },
      body: JSON.stringify(courtForm),
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 401) {
        redirectToAdminLogin();
        return;
      }
      alert(data.error || "Failed to add court.");
      return;
    }

    alert("Court added successfully!");
    setCourtForm(emptyCourtForm);
    loadCourts();
  }

  function startEditBooking(booking) {
    const matchingCourt = courts.find(
      (court) => Number(court.id) === Number(booking.court_id)
    );

    setEditingBookingId(booking.id);
    setAdminBookingForm({
      name: booking.name || "",
      email: booking.email || "",
      mobile: booking.mobile || "",
      date: booking.date || getTodayLocalDate(),
      sport: matchingCourt?.sport || "Pickleball",
      court_id: String(booking.court_id || ""),
      start_time: normalizeTime(booking.start_time),
      end_time: normalizeTime(booking.end_time),
      waiver: true,
      payment_status: booking.payment_status || "Pending",
      notes: booking.notes || "",
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingBookingId(null);
    setAdminBookingForm({
      ...emptyBookingForm,
      sport: "Pickleball",
      date: getTodayLocalDate(),
    });
  }

  async function deleteBooking(id) {
    const confirmed = window.confirm("Delete this booking?");
    if (!confirmed) return;

    const res = await fetch(apiUrl(`/bookings/${id}`), {
      method: "DELETE",
      headers: getAuthorizedHeaders(),
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 401) {
        redirectToAdminLogin();
        return;
      }
      alert(data.error || "Failed to delete booking.");
      return;
    }

    alert("Booking deleted successfully.");
    if (Number(editingBookingId) === Number(id)) {
      cancelEdit();
    }
    loadBookings();
  }

  function handleAdminSportChange(value) {
    setAdminBookingForm((prev) => ({
      ...prev,
      sport: value,
      court_id: "",
      start_time: "",
      end_time: "",
    }));
  }

  function handleAdminCourtChange(value) {
    setAdminBookingForm((prev) => ({
      ...prev,
      court_id: value,
      start_time: "",
      end_time: "",
    }));
  }

  function handleAdminDateChange(value) {
    setAdminBookingForm((prev) => ({
      ...prev,
      date: value,
      start_time: "",
      end_time: "",
    }));
  }

  function handleAdminStartTimeChange(value) {
    setAdminBookingForm((prev) => ({
      ...prev,
      start_time: value,
      end_time: "",
    }));
  }

  const skipCells = new Set();

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-row">
          <div>
            <h1>🎾 RacketHub Admin</h1><br />
            <p>Court schedule management, bookings, and facility administration</p>
          </div>

          <button
            type="button"
            className="mini-refresh-btn"
            onClick={() => refreshDashboardData()}
            disabled={refreshingData}
            title="Refresh courts and bookings"
          >
            {refreshingData ? "Refreshing..." : "Refresh"}
          </button>

          <button
            type="button"
            className="mini-refresh-btn"
            onClick={redirectToAdminLogin}
            title="Sign out admin session"
          >
            Logout
          </button>
        </div>
      </header>

      <section className="schedule-section">
        <div className="schedule-toolbar">
          <div className="sport-buttons">
            <button
              className={selectedSport === "Pickleball" ? "active" : ""}
              onClick={() => setSelectedSport("Pickleball")}
            >
              Pickleball
            </button>
            <button
              className={selectedSport === "Badminton" ? "active" : ""}
              onClick={() => setSelectedSport("Badminton")}
            >
              Badminton
            </button>
          </div>

          <div className="schedule-date-box">
            <DatePickerInput
              label="Schedule Date"
              value={scheduleDate}
              onChange={setScheduleDate}
              minDate={getTodayLocalDate()}
            />
          </div>
        </div>

        <div className="schedule-header">
          <h2>Calendar Schedule</h2>
          <p>{formatDateHeading(scheduleDate)}</p>
        </div>

        <div className="schedule-table-wrapper">
          <table className="schedule-table merged-schedule">
            <thead>
              <tr>
                <th className="time-column">Time</th>
                {scheduleCourts.map((court) => (
                  <th key={court.id}>{court.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TIME_SLOTS.slice(0, -1).map((slotTime) => (
                <tr key={slotTime}>
                  <td className="time-column">{formatTimeDisplay(slotTime)}</td>

                  {scheduleCourts.map((court) => {
                    const key = `${court.id}-${slotTime}`;
                    if (skipCells.has(key)) return null;

                    const booking = getBookingForCell(court.id, scheduleDate, slotTime);

                    if (!booking) {
                      return (
                        <td key={key}>
                          <div className="slot-cell available">
                            <span>Available</span>
                          </div>
                        </td>
                      );
                    }

                    const isStart = normalizeTime(booking.start_time) === normalizeTime(slotTime);

                    if (!isStart) {
                      return null;
                    }

                    const rowSpan = getRowSpan(booking);
                    const pendingMinutesLeft = getPendingMinutesLeft(booking);

                    for (let i = 1; i < rowSpan; i++) {
                      const futureSlot = TIME_SLOTS[getSlotIndex(slotTime) + i];
                      if (futureSlot) {
                        skipCells.add(`${court.id}-${futureSlot}`);
                      }
                    }

                    return (
                      <td key={key} rowSpan={rowSpan} className="merged-cell">
                        <div
                            className={`slot-cell occupied merged-booking ${
                              isPendingPayment(booking.payment_status)
                                ? "pending-booking"
                                : ""
                            }`}
                            style={{
                            minHeight: `${getMergedBookingHeight(rowSpan)}px`,
                            }}
                        >
                          <strong>{booking.name}</strong>
                          <small>
                            {formatTimeDisplay(booking.start_time)} -{" "}
                            {formatTimeDisplay(booking.end_time)}
                          </small>
                          <small>
                            {booking.payment_status}
                            {pendingMinutesLeft != null
                              ? ` - ${pendingMinutesLeft} min left`
                              : ""}
                          </small>
                          <small>
                            {formatBookingHoursLabel(booking.total_hours)} - {"\u20B1"}
                            {booking.total_price}
                          </small>
                          {/* <div className="slot-actions">
                            <button onClick={() => startEditBooking(booking)}>
                              Edit
                            </button>
                            <button
                              className="danger-btn"
                              onClick={() => deleteBooking(booking.id)}
                            >
                              Delete
                            </button>
                          </div> */}
                          <div className="slot-actions">
                            <button
                                type="button"
                                className="icon-btn"
                                title="Edit booking"
                                onClick={() => startEditBooking(booking)}
                            >
                                <svg
                                viewBox="0 0 24 24"
                                width="16"
                                height="16"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                                >
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
                                </svg>
                            </button>

                            <button
                                type="button"
                                className="icon-btn danger-icon-btn"
                                title="Delete booking"
                                onClick={() => deleteBooking(booking.id)}
                            >
                                <svg
                                viewBox="0 0 24 24"
                                width="16"
                                height="16"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                                >
                                <path d="M3 6h18" />
                                <path d="M8 6V4h8v2" />
                                <path d="M19 6l-1 14H6L5 6" />
                                <path d="M10 11v6" />
                                <path d="M14 11v6" />
                                </svg>
                            </button>
                            </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-grid">
        <div className="admin-card">
          <h2>{editingBookingId ? "Edit Booking" : "Manual Add Booking"}</h2>

          <form className="booking-form" onSubmit={handleAdminBookingSubmit}>
            <input
              type="text"
              placeholder="Full Name"
              value={adminBookingForm.name}
              onChange={(e) =>
                setAdminBookingForm({ ...adminBookingForm, name: e.target.value })
              }
              required
            />

            <input
              type="email"
              placeholder="Email"
              value={adminBookingForm.email}
              onChange={(e) =>
                setAdminBookingForm({ ...adminBookingForm, email: e.target.value })
              }
              required
            />

            <input
              type="text"
              placeholder="Mobile Number"
              value={adminBookingForm.mobile}
              onChange={(e) =>
                setAdminBookingForm({ ...adminBookingForm, mobile: e.target.value })
              }
              required
            />

            <input
              type="date"
              value={adminBookingForm.date}
              onChange={(e) => handleAdminDateChange(e.target.value)}
              required
            />

            <select
              value={adminBookingForm.sport}
              onChange={(e) => handleAdminSportChange(e.target.value)}
            >
              <option value="Pickleball">Pickleball</option>
              <option value="Badminton">Badminton</option>
            </select>

            <select
              value={adminBookingForm.court_id}
              onChange={(e) => handleAdminCourtChange(e.target.value)}
              required
              disabled={loadingCourts || adminFormCourts.length === 0}
            >
              <option value="">
                {loadingCourts
                  ? "Loading courts..."
                  : adminFormCourts.length === 0
                  ? "No courts available"
                  : "Select Court"}
              </option>
              {adminFormCourts.map((court) => (
                <option key={court.id} value={court.id}>
                  {court.name}
                </option>
              ))}
            </select>

            <select
              value={adminBookingForm.start_time}
              onChange={(e) => handleAdminStartTimeChange(e.target.value)}
              required
              disabled={!adminBookingForm.date || !adminBookingForm.court_id}
            >
              <option value="">
                {!adminBookingForm.date || !adminBookingForm.court_id
                  ? "Select date and court first"
                  : "Select Start Time"}
              </option>
              {adminAvailableStartTimes.map((time) => (
                <option key={time} value={time}>
                  {formatTimeDisplay(time)}
                </option>
              ))}
            </select>

            <select
              value={adminBookingForm.end_time}
              onChange={(e) =>
                setAdminBookingForm({ ...adminBookingForm, end_time: e.target.value })
              }
              required
              disabled={!adminBookingForm.start_time}
            >
              <option value="">
                {!adminBookingForm.start_time
                  ? "Select start time first"
                  : "Select End Time"}
              </option>
              {adminAvailableEndTimes.map((time) => (
                <option key={time} value={time}>
                  {formatTimeDisplay(time)}
                </option>
              ))}
            </select>

            <select
              value={adminBookingForm.payment_status}
              onChange={(e) =>
                setAdminBookingForm({
                  ...adminBookingForm,
                  payment_status: e.target.value,
                })
              }
            >
              <option value="Pending">Payment Pending</option>
              <option value="Paid">Paid</option>
            </select>

            <textarea
              placeholder="Notes"
              value={adminBookingForm.notes}
              onChange={(e) =>
                setAdminBookingForm({ ...adminBookingForm, notes: e.target.value })
              }
            />

            <div className="summary-box">
              <p><strong>Total Hours:</strong> {adminTotalHours}</p>
              <p><strong>Total Rate:</strong> ₱{adminTotalRate}</p>
            </div>

            <button type="submit">
              {editingBookingId ? "Update Booking" : "Save Booking"}
            </button>

            {editingBookingId && (
              <button
                type="button"
                className="secondary-btn"
                onClick={cancelEdit}
              >
                Cancel Edit
              </button>
            )}
          </form>
        </div>

        <div className="admin-card">
          <h2>Add Court</h2>

          <form className="single-form" onSubmit={handleAddCourt}>
            <input
              type="text"
              placeholder="Court Name"
              value={courtForm.name}
              onChange={(e) =>
                setCourtForm({ ...courtForm, name: e.target.value })
              }
              required
            />

            <select
              value={courtForm.sport}
              onChange={(e) =>
                setCourtForm({ ...courtForm, sport: e.target.value })
              }
            >
              <option value="Pickleball">Pickleball</option>
              <option value="Badminton">Badminton</option>
            </select>

            <button type="submit">Add Court</button>
          </form>
        </div>
      </section>
    </div>
  );
}

