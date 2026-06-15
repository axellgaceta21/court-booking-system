const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
require("dotenv").config({ path: path.resolve(__dirname, "server/.env") });

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

const PENDING_PAYMENT_WINDOW_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const PORT = Number(process.env.PORT || 5050);
const ADMIN_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const ADMIN_SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET || "change-this-admin-secret";

const supabase = createClient(
  "https://dvxpuuenvtzagpzkgexe.supabase.co",
  "sb_publishable_ysOsMcn68FesDVg1ZkPkdw_s6Hd6AIC"
);

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

function normalizeTime(time) {
  if (!time) return "";
  return String(time).slice(0, 5);
}

function getSlotIndex(time) {
  return TIME_SLOTS.indexOf(normalizeTime(time));
}

function calculateHoursBySlots(start, end) {
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

function calculateMixedRateBySlots(start, end) {
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

function isTimeRangeOverlapping(newStart, newEnd, existingStart, existingEnd) {
  const newStartIndex = getSlotIndex(newStart);
  const newEndIndex = getSlotIndex(newEnd);
  const existingStartIndex = getSlotIndex(existingStart);
  const existingEndIndex = getSlotIndex(existingEnd);

  if (
    newStartIndex === -1 ||
    newEndIndex === -1 ||
    existingStartIndex === -1 ||
    existingEndIndex === -1
  ) {
    return false;
  }

  return newStartIndex < existingEndIndex && newEndIndex > existingStartIndex;
}

function normalizePaymentStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function getAdminTokenSignature(encodedPayload) {
  return crypto
    .createHmac("sha256", ADMIN_SESSION_SECRET)
    .update(encodedPayload)
    .digest("base64url");
}

function createAdminToken(username) {
  const payload = {
    username,
    exp: Date.now() + ADMIN_TOKEN_TTL_MS,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = getAdminTokenSignature(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

function verifyAdminToken(token) {
  if (!token || typeof token !== "string") {
    return { valid: false, reason: "Token missing." };
  }

  const [encodedPayload, providedSignature] = token.split(".");
  if (!encodedPayload || !providedSignature) {
    return { valid: false, reason: "Token format invalid." };
  }

  const expectedSignature = getAdminTokenSignature(encodedPayload);

  try {
    const providedBuffer = Buffer.from(providedSignature, "utf8");
    const expectedBuffer = Buffer.from(expectedSignature, "utf8");

    if (
      providedBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      return { valid: false, reason: "Token signature invalid." };
    }
  } catch (error) {
    return { valid: false, reason: "Token signature invalid." };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch (error) {
    return { valid: false, reason: "Token payload invalid." };
  }

  if (!payload?.exp || Date.now() > Number(payload.exp)) {
    return { valid: false, reason: "Token expired." };
  }

  return { valid: true, payload };
}

function getBearerToken(req) {
  const authHeader = String(req.headers.authorization || "").trim();
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return "";
  }
  return authHeader.slice(7).trim();
}

function requireAdminAuth(req, res, next) {
  const token = getBearerToken(req);
  const verification = verifyAdminToken(token);

  if (!verification.valid) {
    return res.status(401).json({ error: "Unauthorized admin access." });
  }

  req.admin = verification.payload;
  next();
}

function isPendingStatus(status) {
  return normalizePaymentStatus(status).includes("pending");
}

function shouldResetPendingTimer(previousStatus, nextStatus) {
  return (
    !isPendingStatus(previousStatus) &&
    isPendingStatus(nextStatus)
  );
}

async function recreateBookingWithFreshTimestamp(bookingId, bookingPayload) {
  const { data: insertedRows, error: insertError } = await supabase
    .from("bookings")
    .insert([bookingPayload])
    .select();

  if (insertError) {
    throw new Error(insertError.message);
  }

  const insertedBooking = Array.isArray(insertedRows) ? insertedRows[0] : null;

  const { error: deleteError } = await supabase
    .from("bookings")
    .delete()
    .eq("id", bookingId);

  if (deleteError) {
    // Best-effort rollback so we do not leave duplicate rows.
    if (insertedBooking?.id) {
      await supabase.from("bookings").delete().eq("id", insertedBooking.id);
    }
    throw new Error(deleteError.message);
  }

  return insertedBooking;
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

function isExpiredPendingBooking(booking, now = Date.now()) {
  if (!isPendingStatus(booking?.payment_status)) {
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

  return now - createdAtMs >= PENDING_PAYMENT_WINDOW_MS;
}

async function cleanupExpiredPendingBookings() {
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("*");

  if (error) {
    throw new Error(error.message);
  }

  const expiredBookingIds = (bookings || [])
    .filter((booking) => isExpiredPendingBooking(booking))
    .map((booking) => booking.id);

  if (expiredBookingIds.length === 0) {
    return 0;
  }

  const { error: deleteError } = await supabase
    .from("bookings")
    .delete()
    .in("id", expiredBookingIds);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  return expiredBookingIds.length;
}

async function hasBookingConflict({ court_id, date, start_time, end_time, excludeBookingId = null }) {
  await cleanupExpiredPendingBookings();

  const { data: existingBookings, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("court_id", court_id)
    .eq("date", date);

  if (error) {
    throw new Error(error.message);
  }

  return (existingBookings || []).some((booking) => {
    if (excludeBookingId && Number(booking.id) === Number(excludeBookingId)) {
      return false;
    }

    if (isExpiredPendingBooking(booking)) {
      return false;
    }

    return isTimeRangeOverlapping(
      start_time,
      end_time,
      booking.start_time,
      booking.end_time
    );
  });
}

app.get("/", (req, res) => {
  res.send("Backend is running!");
});

app.post("/admin/login", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid admin credentials." });
  }

  const token = createAdminToken(username);
  res.json({
    token,
    expires_in_ms: ADMIN_TOKEN_TTL_MS,
    username,
  });
});

app.get("/admin/session", requireAdminAuth, (req, res) => {
  res.json({
    ok: true,
    username: req.admin.username,
    expires_at: req.admin.exp,
  });
});

app.get("/courts", async (req, res) => {
  const { data, error } = await supabase
    .from("courts")
    .select("*")
    .order("id", { ascending: true });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
});

app.post("/courts", requireAdminAuth, async (req, res) => {
  const { name, sport } = req.body;

  if (!name || !sport) {
    return res.status(400).json({ error: "Court name and sport are required." });
  }

  const { data, error } = await supabase
    .from("courts")
    .insert([{ name: String(name).trim(), sport: String(sport).trim() }])
    .select();

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json(data);
});

app.get("/bookings", async (req, res) => {
  try {
    await cleanupExpiredPendingBookings();
  } catch (cleanupError) {
    return res.status(500).json({ error: cleanupError.message });
  }

  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .order("date", { ascending: true });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const normalizedBookings = (data || [])
    .filter((booking) => !isExpiredPendingBooking(booking))
    .map((booking) => ({
      ...booking,
      start_time: normalizeTime(booking.start_time),
      end_time: normalizeTime(booking.end_time),
    }))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return getSlotIndex(a.start_time) - getSlotIndex(b.start_time);
    });

  res.json(normalizedBookings);
});

app.post("/book", async (req, res) => {
  try {
    await cleanupExpiredPendingBookings();

    const {
      court_id,
      name,
      email,
      mobile,
      date,
      start_time,
      end_time,
      payment_status,
      notes,
    } = req.body;

    const cleanStart = normalizeTime(start_time);
    const cleanEnd = normalizeTime(end_time);

    if (
      !court_id ||
      !name ||
      !email ||
      !mobile ||
      !date ||
      !cleanStart ||
      !cleanEnd
    ) {
      return res.status(400).json({
        error: "Please fill in all required booking fields.",
      });
    }

    const totalHours = calculateHoursBySlots(cleanStart, cleanEnd);

    if (totalHours <= 0) {
      return res.status(400).json({
        error: "End time must be later than start time.",
      });
    }

    const hasConflict = await hasBookingConflict({
      court_id,
      date,
      start_time: cleanStart,
      end_time: cleanEnd,
    });

    if (hasConflict) {
      return res.status(400).json({
        error: "This court is already booked for the selected time range.",
      });
    }

    const totalPrice = calculateMixedRateBySlots(cleanStart, cleanEnd);

    const { data, error } = await supabase
      .from("bookings")
      .insert([
        {
          court_id,
          name,
          email,
          mobile,
          date,
          start_time: cleanStart,
          end_time: cleanEnd,
          total_hours: totalHours,
          total_price: totalPrice,
          payment_status,
          notes,
        },
      ])
      .select();

    if (error) {
      return res.status(400).json({
        error: error.message,
      });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({
      error: err.message || "Server error while creating booking.",
    });
  }
});

app.put("/bookings/:id", requireAdminAuth, async (req, res) => {
  try {
    await cleanupExpiredPendingBookings();

    const bookingId = req.params.id;
    const {
      court_id,
      name,
      email,
      mobile,
      date,
      start_time,
      end_time,
      payment_status,
      notes,
    } = req.body;

    const { data: existingBooking, error: existingBookingError } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .single();

    if (existingBookingError) {
      return res.status(404).json({ error: existingBookingError.message });
    }

    const cleanStart = normalizeTime(start_time);
    const cleanEnd = normalizeTime(end_time);

    if (
      !court_id ||
      !name ||
      !email ||
      !mobile ||
      !date ||
      !cleanStart ||
      !cleanEnd
    ) {
      return res.status(400).json({
        error: "Please fill in all required booking fields.",
      });
    }

    const totalHours = calculateHoursBySlots(cleanStart, cleanEnd);

    if (totalHours <= 0) {
      return res.status(400).json({
        error: "End time must be later than start time.",
      });
    }

    const hasConflict = await hasBookingConflict({
      court_id,
      date,
      start_time: cleanStart,
      end_time: cleanEnd,
      excludeBookingId: bookingId,
    });

    if (hasConflict) {
      return res.status(400).json({
        error: "This court is already booked for the selected time range.",
      });
    }

    const totalPrice = calculateMixedRateBySlots(cleanStart, cleanEnd);

    const updatePayload = {
      court_id,
      name,
      email,
      mobile,
      date,
      start_time: cleanStart,
      end_time: cleanEnd,
      total_hours: totalHours,
      total_price: totalPrice,
      payment_status,
      notes,
    };

    const resetPendingTimer = shouldResetPendingTimer(
      existingBooking.payment_status,
      payment_status
    );

    if (resetPendingTimer) {
      const recreatedBooking = await recreateBookingWithFreshTimestamp(
        bookingId,
        updatePayload
      );
      return res.json([recreatedBooking]);
    }

    const { data, error } = await supabase
      .from("bookings")
      .update(updatePayload)
      .eq("id", bookingId)
      .select();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({
      error: err.message || "Server error while updating booking.",
    });
  }
});

app.delete("/bookings/:id", requireAdminAuth, async (req, res) => {
  try {
    await cleanupExpiredPendingBookings();
  } catch (cleanupError) {
    return res.status(500).json({ error: cleanupError.message });
  }

  const bookingId = req.params.id;

  const { error } = await supabase
    .from("bookings")
    .delete()
    .eq("id", bookingId);

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({ message: "Booking deleted successfully." });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

setInterval(() => {
  cleanupExpiredPendingBookings().catch((error) => {
    console.error("Failed to clean up expired pending bookings:", error.message);
  });
}, CLEANUP_INTERVAL_MS);
