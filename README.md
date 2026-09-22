# Seva Swasthya

A working Node.js + Express + SQLite web app with:

- Three public portals: Mental, Physical, Financial
- Problem submission
- Anonymous submission option
- Separate portal admins
- Super admin
- Secure password hashing with bcrypt
- Admin dashboard with status and internal notes
- Optional SMS notification through Twilio
- Ready for local testing and Render deployment

## 1. Install

Install Node.js LTS, then in this folder:

```bash
npm install
```

## 2. Configure

Copy `.env.example` to `.env` and change:

```text
SESSION_SECRET=use-a-long-random-secret
```

The demo admin accounts are:

```text
mental_admin / mental123
physical_admin / physical123
financial_admin / financial123
super_admin / super123
```

Change all passwords before real use.

## 3. Run

```bash
npm start
```

Open:

http://localhost:3000

Admin:

http://localhost:3000/admin

## 4. SMS notification

Create a Twilio account and put its credentials in `.env`:

```text
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=

MENTAL_ADMIN_PHONE=+91XXXXXXXXXX
PHYSICAL_ADMIN_PHONE=+91XXXXXXXXXX
FINANCIAL_ADMIN_PHONE=+91XXXXXXXXXX
SUPER_ADMIN_PHONE=+91XXXXXXXXXX
```

When a problem is submitted, the relevant admin and super admin receive an SMS if Twilio is configured.

## 5. Render deployment

Create a new Web Service on Render and connect this GitHub repository.

Build command:

```bash
npm install
```

Start command:

```bash
npm start
```

Add the `.env` values in Render's Environment Variables section.

Important: SQLite is fine for a small demo/internal deployment, but for a production service with multiple users, use a managed PostgreSQL database and persistent storage. Also add proper consent/privacy policy, HTTPS, rate limiting, audit logs, and stronger account recovery before handling real sensitive health or financial information.
