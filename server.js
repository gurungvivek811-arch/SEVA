require("dotenv").config();

const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const twilio = require("twilio");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database(path.join(__dirname, "seva-swasthya.db"));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || "dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: false, maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(express.static(path.join(__dirname, "public")));

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('mental','physical','financial','super')),
  phone TEXT
);

CREATE TABLE IF NOT EXISTS problems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portal TEXT NOT NULL CHECK(portal IN ('mental','physical','financial')),
  name TEXT,
  phone TEXT,
  anonymous INTEGER NOT NULL DEFAULT 0,
  urgency TEXT NOT NULL DEFAULT 'normal',
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  admin_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function seedAdmin(username, password, role, phone) {
  const existing = db.prepare("SELECT id FROM admins WHERE username=?").get(username);
  if (!existing) {
    const hash = bcrypt.hashSync(password, 12);
    db.prepare("INSERT INTO admins(username,password_hash,role,phone) VALUES(?,?,?,?)")
      .run(username, hash, role, phone || "");
  }
}
seedAdmin("mental_admin", process.env.MENTAL_ADMIN_PASSWORD || "mental123", "mental", process.env.MENTAL_ADMIN_PHONE);
seedAdmin("physical_admin", process.env.PHYSICAL_ADMIN_PASSWORD || "physical123", "physical", process.env.PHYSICAL_ADMIN_PHONE);
seedAdmin("financial_admin", process.env.FINANCIAL_ADMIN_PASSWORD || "financial123", "financial", process.env.FINANCIAL_ADMIN_PHONE);
seedAdmin("super_admin", process.env.SUPER_ADMIN_PASSWORD || "super123", "super", process.env.SUPER_ADMIN_PHONE);

const portalNames = {
  mental: "Mental Health",
  physical: "Physical Health",
  financial: "Financial Health"
};

function auth(req, res, next) {
  if (!req.session.admin) return res.status(401).json({ error: "Login required" });
  next();
}

function canSee(admin, portal) {
  return admin.role === "super" || admin.role === portal;
}

async function sendSMS(to, body) {
  if (!to || !process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM_NUMBER) {
    return { sent: false, reason: "SMS is not configured" };
  }
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({ from: process.env.TWILIO_FROM_NUMBER, to, body });
    return { sent: true };
  } catch (e) {
    console.error("SMS error:", e.message);
    return { sent: false, reason: "SMS provider error" };
  }
}

function notificationNumbers(portal) {
  const specific = {
    mental: process.env.MENTAL_ADMIN_PHONE,
    physical: process.env.PHYSICAL_ADMIN_PHONE,
    financial: process.env.FINANCIAL_ADMIN_PHONE
  }[portal];
  return [specific, process.env.SUPER_ADMIN_PHONE].filter(Boolean);
}

app.get("/api/session", (req, res) => {
  res.json({ loggedIn: !!req.session.admin, admin: req.session.admin || null });
});

app.post("/api/submit", async (req, res) => {
  const { portal, name, phone, anonymous, urgency, title, description } = req.body;
  if (!portalNames[portal]) return res.status(400).json({ error: "Invalid portal" });
  if (!title || !description) return res.status(400).json({ error: "Title and description are required" });

  const isAnonymous = !!anonymous;
  const safeName = isAnonymous ? "" : String(name || "").trim();
  const safePhone = isAnonymous ? "" : String(phone || "").trim();

  const result = db.prepare(`
    INSERT INTO problems(portal,name,phone,anonymous,urgency,title,description)
    VALUES(?,?,?,?,?,?,?)
  `).run(portal, safeName, safePhone, isAnonymous ? 1 : 0, urgency || "normal",
         String(title).trim(), String(description).trim());

  const text = `Seva Swasthya: New ${portalNames[portal]} problem received today. Problem ID #${result.lastInsertRowid}. Please check the admin dashboard.`;
  const numbers = notificationNumbers(portal);
  for (const number of numbers) await sendSMS(number, text);

  res.json({ ok: true, id: result.lastInsertRowid });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare("SELECT * FROM admins WHERE username=?").get(username);
  if (!admin || !bcrypt.compareSync(password || "", admin.password_hash)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  req.session.admin = { id: admin.id, username: admin.username, role: admin.role, phone: admin.phone };
  res.json({ ok: true, admin: req.session.admin });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/problems", auth, (req, res) => {
  const { role } = req.session.admin;
  const rows = role === "super"
    ? db.prepare("SELECT * FROM problems ORDER BY created_at DESC, id DESC").all()
    : db.prepare("SELECT * FROM problems WHERE portal=? ORDER BY created_at DESC, id DESC").all(role);
  res.json(rows);
});

app.patch("/api/problems/:id", auth, (req, res) => {
  const problem = db.prepare("SELECT * FROM problems WHERE id=?").get(req.params.id);
  if (!problem) return res.status(404).json({ error: "Problem not found" });
  if (!canSee(req.session.admin, problem.portal)) return res.status(403).json({ error: "Not allowed" });

  const status = ["new","in_progress","resolved"].includes(req.body.status) ? req.body.status : problem.status;
  const note = typeof req.body.admin_note === "string" ? req.body.admin_note : problem.admin_note;

  db.prepare("UPDATE problems SET status=?, admin_note=? WHERE id=?").run(status, note, problem.id);
  res.json({ ok: true });
});

app.get("/api/stats", auth, (req, res) => {
  const role = req.session.admin.role;
  const where = role === "super" ? "" : " WHERE portal=?";
  const params = role === "super" ? [] : [role];
  const rows = db.prepare(`
    SELECT status, COUNT(*) count FROM problems${where} GROUP BY status
  `).all(...params);
  const stats = { new: 0, in_progress: 0, resolved: 0 };
  rows.forEach(r => stats[r.status] = r.count);
  res.json(stats);
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Seva Swasthya running on port ${PORT}`);
});
