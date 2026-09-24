require("dotenv").config();

const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "database.json");


// ======================================================
// CREATE DATA FOLDER / DATABASE
// ======================================================

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(
      {
        admins: [],
        problems: [],
        nextAdminId: 1,
        nextProblemId: 1
      },
      null,
      2
    )
  );
}


// ======================================================
// DATABASE FUNCTIONS
// ======================================================

function readDatabase() {
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");

    const data = JSON.parse(raw);

    return {
      admins: Array.isArray(data.admins) ? data.admins : [],
      problems: Array.isArray(data.problems) ? data.problems : [],
      nextAdminId: Number(data.nextAdminId) || 1,
      nextProblemId: Number(data.nextProblemId) || 1
    };
  } catch (error) {
    console.error("Database read error:", error);

    return {
      admins: [],
      problems: [],
      nextAdminId: 1,
      nextProblemId: 1
    };
  }
}


function writeDatabase(data) {
  try {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(data, null, 2),
      "utf8"
    );

    return true;
  } catch (error) {
    console.error("Database write error:", error);
    return false;
  }
}


// ======================================================
// APP CONFIGURATION
// ======================================================

app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(express.json({ limit: "1mb" }));

app.use(
  express.urlencoded({
    extended: true
  })
);


// ======================================================
// SESSION
// ======================================================

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      "seva-swasthya-change-this-secret",

    resave: false,

    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      sameSite: "lax",

      secure:
        process.env.NODE_ENV === "production",

      maxAge: 1000 * 60 * 60 * 8
    }
  })
);


// ======================================================
// STATIC WEBSITE
// ======================================================

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);


// ======================================================
// PORTAL NAMES
// ======================================================

const portalNames = {
  mental: "Mental Health",
  physical: "Physical Health",
  financial: "Financial Health"
};


// ======================================================
// ADMIN SEEDING
// ======================================================

function seedAdmin(
  username,
  password,
  role
) {
  const db = readDatabase();

  const existing =
    db.admins.find(
      admin =>
        admin.username === username
    );

  if (!existing) {
    const passwordHash =
      bcrypt.hashSync(
        password,
        12
      );

    db.admins.push({
      id: db.nextAdminId++,
      username,
      password_hash: passwordHash,
      role
    });

    writeDatabase(db);

    console.log(
      `Created admin: ${username}`
    );
  }
}


// ======================================================
// CREATE DEFAULT ADMINS
// ======================================================

seedAdmin(
  "mental_admin",
  process.env.MENTAL_ADMIN_PASSWORD ||
    "mental123",
  "mental"
);

seedAdmin(
  "physical_admin",
  process.env.PHYSICAL_ADMIN_PASSWORD ||
    "physical123",
  "physical"
);

seedAdmin(
  "financial_admin",
  process.env.FINANCIAL_ADMIN_PASSWORD ||
    "financial123",
  "financial"
);

seedAdmin(
  "super_admin",
  process.env.SUPER_ADMIN_PASSWORD ||
    "super123",
  "super"
);


// ======================================================
// AUTHENTICATION
// ======================================================

function auth(req, res, next) {
  if (!req.session.admin) {
    return res.status(401).json({
      error: "Login required"
    });
  }

  next();
}


function canSee(admin, portal) {
  return (
    admin.role === "super" ||
    admin.role === portal
  );
}


// ======================================================
// HOME
// ======================================================

app.get("/", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});


// ======================================================
// ADMIN PAGE
// ======================================================

app.get("/admin", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "admin.html"
    )
  );
});


// ======================================================
// HEALTH CHECK
// ======================================================

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      ok: true,
      message:
        "Seva Swasthya server is working"
    });
  }
);


// ======================================================
// DATABASE HEALTH CHECK
// ======================================================

app.get(
  "/api/db-health",
  (req, res) => {
    try {
      const db = readDatabase();

      res.json({
        ok: true,
        database: "connected",
        admins: db.admins.length,
        problems: db.problems.length
      });
    } catch (error) {
      console.error(
        "Database health error:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Database unavailable"
      });
    }
  }
);


// ======================================================
// SESSION CHECK
// ======================================================

app.get(
  "/api/session",
  (req, res) => {
    res.json({
      loggedIn:
        !!req.session.admin,

      admin:
        req.session.admin || null
    });
  }
);


// ======================================================
// SUBMIT PROBLEM
// ======================================================

app.post(
  "/api/submit",
  (req, res) => {
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

      // -----------------------------
      // VALIDATION
      // -----------------------------

      if (!portalNames[portal]) {
        return res.status(400).json({
          error:
            "Invalid portal"
        });
      }

      if (
        !title ||
        !String(title).trim()
      ) {
        return res.status(400).json({
          error:
            "Problem title is required"
        });
      }

      if (
        !description ||
        !String(description).trim()
      ) {
        return res.status(400).json({
          error:
            "Problem description is required"
        });
      }


      // -----------------------------
      // DATABASE
      // -----------------------------

      const db = readDatabase();

      const isAnonymous =
        anonymous === true ||
        anonymous === "true";


      const problem = {
        id: db.nextProblemId++,

        portal,

        name:
          isAnonymous
            ? ""
            : String(name || "").trim(),

        phone:
          isAnonymous
            ? ""
            : String(phone || "").trim(),

        anonymous:
          isAnonymous,

        urgency:
          urgency === "urgent"
            ? "urgent"
            : "normal",

        title:
          String(title)
            .trim()
            .substring(0, 120),

        description:
          String(description)
            .trim()
            .substring(0, 5000),

        status: "new",

        admin_note: "",

        created_at:
          new Date().toISOString()
      };


      db.problems.push(problem);


      const saved =
        writeDatabase(db);


      if (!saved) {
        return res.status(500).json({
          error:
            "Unable to save your concern"
        });
      }


      console.log(
        `New ${portalNames[portal]} problem #${problem.id}`
      );


      // -----------------------------
      // RESPONSE
      // -----------------------------

      res.json({
        ok: true,
        id: problem.id
      });

    } catch (error) {
      console.error(
        "Submit error:",
        error
      );

      res.status(500).json({
        error:
          "Server error while submitting concern"
      });
    }
  }
);


// ======================================================
// ADMIN LOGIN
// ======================================================

app.post(
  "/api/login",
  (req, res) => {
    try {
      const {
        username,
        password
      } = req.body;

      if (
        !username ||
        !password
      ) {
        return res.status(400).json({
          error:
            "Username and password are required"
        });
      }


      const db =
        readDatabase();


      const admin =
        db.admins.find(
          item =>
            item.username ===
            String(username).trim()
        );


      if (!admin) {
        return res.status(401).json({
          error:
            "Invalid username or password"
        });
      }


      const passwordCorrect =
        bcrypt.compareSync(
          String(password),
          admin.password_hash
        );


      if (!passwordCorrect) {
        return res.status(401).json({
          error:
            "Invalid username or password"
        });
      }


      req.session.admin = {
        id: admin.id,
        username: admin.username,
        role: admin.role
      };


      console.log(
        `Admin login: ${admin.username}`
      );


      res.json({
        ok: true,

        admin:
          req.session.admin
      });

    } catch (error) {
      console.error(
        "Login error:",
        error
      );

      res.status(500).json({
        error:
          "Server error during login"
      });
    }
  }
);


// ======================================================
// LOGOUT
// ======================================================

app.post(
  "/api/logout",
  (req, res) => {

    req.session.destroy(
      error => {

        if (error) {
          console.error(
            "Logout error:",
            error
          );

          return res.status(500).json({
            error:
              "Unable to logout"
          });
        }

        res.clearCookie(
          "connect.sid"
        );

        res.json({
          ok: true
        });
      }
    );
  }
);


// ======================================================
// GET PROBLEMS
// ======================================================

app.get(
  "/api/problems",
  auth,
  (req, res) => {

    try {

      const db =
        readDatabase();

      const role =
        req.session.admin.role;


      let problems;


      if (role === "super") {

        problems =
          db.problems;

      } else {

        problems =
          db.problems.filter(
            problem =>
              problem.portal === role
          );

      }


      // Newest first

      problems.sort(
        (a, b) => {

          const dateA =
            new Date(
              a.created_at
            ).getTime();

          const dateB =
            new Date(
              b.created_at
            ).getTime();

          return (
            dateB - dateA ||
            b.id - a.id
          );
        }
      );


      res.json(problems);

    } catch (error) {

      console.error(
        "Problems error:",
        error
      );

      res.status(500).json({
        error:
          "Unable to load problems"
      });
    }
  }
);


// ======================================================
// UPDATE PROBLEM
// ======================================================

app.patch(
  "/api/problems/:id",
  auth,
  (req, res) => {

    try {

      const id =
        Number(req.params.id);


      const db =
        readDatabase();


      const problem =
        db.problems.find(
          item =>
            item.id === id
        );


      if (!problem) {
        return res.status(404).json({
          error:
            "Problem not found"
        });
      }


      if (
        !canSee(
          req.session.admin,
          problem.portal
        )
      ) {
        return res.status(403).json({
          error:
            "You are not allowed to update this problem"
        });
      }


      // -----------------------------
      // STATUS
      // -----------------------------

      const allowedStatuses = [
        "new",
        "in_progress",
        "resolved"
      ];


      if (
        allowedStatuses.includes(
          req.body.status
        )
      ) {
        problem.status =
          req.body.status;
      }


      // -----------------------------
      // ADMIN NOTE
      // -----------------------------

      if (
        typeof req.body.admin_note ===
        "string"
      ) {
        problem.admin_note =
          req.body.admin_note
            .substring(0, 2000);
      }


      problem.updated_at =
        new Date().toISOString();


      const saved =
        writeDatabase(db);


      if (!saved) {
        return res.status(500).json({
          error:
            "Unable to save changes"
        });
      }


      res.json({
        ok: true,
        problem
      });

    } catch (error) {

      console.error(
        "Update error:",
        error
      );

      res.status(500).json({
        error:
          "Unable to update problem"
      });
    }
  }
);


// ======================================================
// STATS
// ======================================================

app.get(
  "/api/stats",
  auth,
  (req, res) => {

    try {

      const db =
        readDatabase();


      const role =
        req.session.admin.role;


      let problems;


      if (role === "super") {

        problems =
          db.problems;

      } else {

        problems =
          db.problems.filter(
            problem =>
              problem.portal === role
          );

      }


      const stats = {
        new: 0,
        in_progress: 0,
        resolved: 0
      };


      problems.forEach(
        problem => {

          if (
            stats[
              problem.status
            ] !== undefined
          ) {

            stats[
              problem.status
            ]++;

          }

        }
      );


      stats.total =
        problems.length;


      res.json(stats);

    } catch (error) {

      console.error(
        "Stats error:",
        error
      );

      res.status(500).json({
        error:
          "Unable to load statistics"
      });
    }
  }
);


// ======================================================
// 404 API HANDLER
// ======================================================

app.use(
  "/api",
  (req, res) => {

    res.status(404).json({
      error:
        "API endpoint not found"
    });

  }
);


// ======================================================
// SERVER START
// ======================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "======================================"
    );

    console.log(
      "SEVA SWASTHYA SERVER"
    );

    console.log(
      `Running on port ${PORT}`
    );

    console.log(
      "Database: JSON"
    );

    console.log(
      "======================================"
    );

  }
);
