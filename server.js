require("dotenv").config();

const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// =========================
// DATABASE
// =========================
const dbPath = path.join(__dirname, "seva-swasthya.db");
const db = new Database(dbPath);

// Do not use WAL for now; keep SQLite setup simple on Render.

// =========================
// APP CONFIG
// =========================
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =========================
// SESSION
// =========================
app.use(session({
  secret: process.env.SESSION_SECRET || "dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

// =========================
// STATIC FILES
// =========================
app.use(express.static(path.join(__dirname, "public")));

// =========================
// DATABASE TABLES
// =========================
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

// =========================
// CREATE DEFAULT ADMINS
// =========================
function seedAdmin(username, password, role, phone) {
  const existing = db
    .prepare("SELECT id FROM admins WHERE username = ?")
    .get(username);

  if (!existing) {
    const hash = bcrypt.hashSync(password, 12);

    db.prepare(`
      INSERT INTO admins
      (username, password_hash, role, phone)
      VALUES (?, ?, ?, ?)
    `).run(
      username,
      hash,
      role,
      phone || ""
    );

    console.log(`Created admin: ${username}`);
  }
}

seedAdmin(
  "mental_admin",
  process.env.MENTAL_ADMIN_PASSWORD || "mental123",
  "mental",
  process.env.MENTAL_ADMIN_PHONE
);

seedAdmin(
  "physical_admin",
  process.env.PHYSICAL_ADMIN_PASSWORD || "physical123",
  "physical",
  process.env.PHYSICAL_ADMIN_PHONE
);

seedAdmin(
  "financial_admin",
  process.env.FINANCIAL_ADMIN_PASSWORD || "financial123",
  "financial",
  process.env.FINANCIAL_ADMIN_PHONE
);

seedAdmin(
  "super_admin",
  process.env.SUPER_ADMIN_PASSWORD || "super123",
  "super",
  process.env.SUPER_ADMIN_PHONE
);

// =========================
// PORTAL NAMES
// =========================
const portalNames = {
  mental: "Mental Health",
  physical: "Physical Health",
  financial: "Financial Health"
};

// =========================
// AUTHENTICATION MIDDLEWARE
// =========================
function auth(req, res, next) {
  if (!req.session.admin) {
    return res.status(401).json({
      error: "Login required"
    });
  }

  next();
}

// =========================
// HEALTH CHECK
// =========================

// Server test
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "Seva Swasthya server is working"
  });
});

// Database test
app.get("/api/db-health", (req, res) => {
  try {
    const result = db.prepare("SELECT 1 AS test").get();

    res.json({
      ok: true,
      database: "connected",
      result
    });
  } catch (error) {
    console.error("Database error:", error);

    res.status(500).json({
      ok: false,
      database: "error",
      error: error.message
    });
  }
});

// =========================
// SESSION CHECK
// =========================
app.get("/api/session", (req, res) => {
  res.json({
    loggedIn: !!req.session.admin,
    admin: req.session.admin || null
  });
});

// =========================
// SUBMIT PROBLEM
// =========================
app.post("/api/submit", (req, res) => {
  try {
    const {
      portal,
      name,
      phone,
      anonymous,
      urgency,
      title,
      description
    } = req.body;

    if (!portalNames[portal]) {
      return res.status(400).json({
        error: "Invalid portal"
      });
    }

    if (!title || !description) {
      return res.status(400).json({
        error: "Title and description are required"
      });
    }

    const isAnonymous = !!anonymous;

    const safeName = isAnonymous
      ? ""
      : String(name || "").trim();

    const safePhone = isAnonymous
      ? ""
      : String(phone || "").trim();

    const safeTitle = String(title).trim();
    const safeDescription = String(description).trim();

    const safeUrgency =
      urgency === "urgent" ? "urgent" : "normal";

    const result = db.prepare(`
      INSERT INTO problems
      (
        portal,
        name,
        phone,
        anonymous,
        urgency,
        title,
        description
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      portal,
      safeName,
      safePhone,
      isAnonymous ? 1 : 0,
      safeUrgency,
      safeTitle,
      safeDescription
    );

    console.log(
      `New ${portalNames[portal]} problem #${result.lastInsertRowid}`
    );

    res.json({
      ok: true,
      id: result.lastInsertRowid
    });

  } catch (error) {
    console.error("Submit error:", error);

    res.status(500).json({
      error: "Unable to submit problem"
    });
  }
});

// =========================
// ADMIN LOGIN
// =========================
app.post("/api/login", (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!username || !password) {
      return res.status(400).json({
        error: "Username and password are required"
      });
    }

    const admin = db
      .prepare("SELECT * FROM admins WHERE username = ?")
      .get(username);

    if (
      !admin ||
      !bcrypt.compareSync(password, admin.password_hash)
    ) {
      return res.status(401).json({
        error: "Invalid username or password"
      });
    }

    req.session.admin = {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      phone: admin.phone
    };

    req.session.save((err) => {
      if (err) {
        console.error("Session save error:", err);

        return res.status(500).json({
          error: "Unable to create login session"
        });
      }

      res.json({
        ok: true,
        admin: req.session.admin
      });
    });

  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({
      error: "Server error during login"
    });
  }
});

// =========================
// LOGOUT
// =========================
app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err);

      return res.status(500).json({
        error: "Unable to logout"
      });
    }

    res.clearCookie("connect.sid");

    res.json({
      ok: true
    });
  });
});

// =========================
// GET PROBLEMS
// =========================
app.get("/api/problems", auth, (req, res) => {
  try {
    const role = req.session.admin.role;

    let rows;

    if (role === "super") {
      rows = db
        .prepare(`
          SELECT *
          FROM problems
          ORDER BY created_at DESC, id DESC
        `)
        .all();
    } else {
      rows = db
        .prepare(`
          SELECT *
          FROM problems
          WHERE portal = ?
          ORDER BY created_at DESC, id DESC
        `)
        .all(role);
    }

    res.json(rows);

  } catch (error) {
    console.error("Problems error:", error);

    res.status(500).json({
      error: "Unable to load problems"
    });
  }
});

// =========================
// UPDATE PROBLEM
// =========================
app.patch("/api/problems/:id", auth, (req, res) => {
  try {
    const problem = db
      .prepare("SELECT * FROM problems WHERE id = ?")
      .get(req.params.id);

    if (!problem) {
      return res.status(404).json({
        error: "Problem not found"
      });
    }

    const admin = req.session.admin;

    if (
      admin.role !== "super" &&
      admin.role !== problem.portal
    ) {
      return res.status(403).json({
        error: "Not allowed"
      });
    }

    const status = [
      "new",
      "in_progress",
      "resolved"
    ].includes(req.body.status)
      ? req.body.status
      : problem.status;

    const note =
      typeof req.body.admin_note === "string"
        ? req.body.admin_note
        : problem.admin_note;

    db.prepare(`
      UPDATE problems
      SET status = ?, admin_note = ?
      WHERE id = ?
    `).run(
      status,
      note,
      problem.id
    );

    res.json({
      ok: true
    });

  } catch (error) {
    console.error("Update problem error:", error);

    res.status(500).json({
      error: "Unable to update problem"
    });
  }
});

// =========================
// STATISTICS
// =========================
app.get("/api/stats", auth, (req, res) => {
  try {
    const role = req.session.admin.role;

    let rows;

    if (role === "super") {
      rows = db.prepare(`
        SELECT status, COUNT(*) AS count
        FROM problems
        GROUP BY status
      `).all();
    } else {
      rows = db.prepare(`
        SELECT status, COUNT(*) AS count
        FROM problems
        WHERE portal = ?
        GROUP BY status
      `).all(role);
    }

    const stats = {
      new: 0,
      in_progress: 0,
      resolved: 0
    };

    rows.forEach((row) => {
      stats[row.status] = row.count;
    });

    res.json(stats);

  } catch (error) {
    console.error("Stats error:", error);

    res.status(500).json({
      error: "Unable to load statistics"
    });
  }
});

// =========================
// WEBSITE ROUTES
// =========================
app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

app.get("/admin", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "admin.html")
  );
});

// =========================
// START SERVER
// =========================
app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Seva Swasthya running on port ${PORT}`
  );
  console.log(`Port: ${PORT}`);
});
