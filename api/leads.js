// Vercel Serverless Function: POST /api/leads
// Validates an "Israel Property Brief" submission and appends it as a row to a Google Sheet.
// Zero dependencies: authenticates with a Google service account by signing a JWT with Node's crypto.
// Setup: see SETUP_SHEETS.md

const crypto = require("crypto");

// Keep in sync with the option lists in index.html
const OBJECTIVES = ["Investment", "Second home", "Future Aliyah or relocation", "Exploring"];
const BUDGETS = ["$250k", "$400k", "$600k", "$1M+", "Custom"];
const TIMELINES = ["Within 6 months", "6–12 months", "12+ months"];
const YES_NO = ["Yes", "No"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+()\d\s.\-]{7,25}$/;

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function validate(body) {
  const fields = {};
  const lead = {
    name: str(body.name, 120),
    email: str(body.email, 200).toLowerCase(),
    phone: str(body.phone, 40),
    objective: str(body.objective, 60),
    budget: str(body.budget, 20),
    budgetCustom: str(body.budgetCustom, 60),
    locations: Array.isArray(body.locations)
      ? body.locations.map((l) => str(l, 120)).filter(Boolean).slice(0, 15)
      : [],
    timeline: str(body.timeline, 40),
    fromUS: str(body.fromUS, 5),
  };

  if (lead.name.length < 2) fields.name = "Please enter your full name.";
  if (!EMAIL_RE.test(lead.email)) fields.email = "Please enter a valid email address.";
  if (lead.phone && !PHONE_RE.test(lead.phone)) fields.phone = "Please enter a valid phone number, or leave it blank.";
  if (!OBJECTIVES.includes(lead.objective)) fields.objective = "Please choose your primary objective.";
  if (!BUDGETS.includes(lead.budget)) fields.budget = "Please choose an approximate budget.";
  if (lead.budget === "Custom" && !lead.budgetCustom) fields.budgetCustom = "Please describe your budget.";
  if (!lead.locations.length) fields.locations = "Choose at least one location, or “Not sure yet”.";
  if (!TIMELINES.includes(lead.timeline)) fields.timeline = "Please choose a timeline.";
  if (!YES_NO.includes(lead.fromUS)) fields.fromUS = "Please let us know.";
  if (body.consent !== true) fields.consent = "Please confirm so we can contact you.";

  return { fields, lead };
}

function readConfig() {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  // Private keys pasted into env vars usually have literal "\n" sequences — restore real newlines.
  const privateKey = (process.env.GOOGLE_SHEETS_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const range = process.env.GOOGLE_SHEET_RANGE || "A1"; // "A1" = first tab; use e.g. "Leads!A1" for a named tab
  if (!clientEmail || !privateKey || !sheetId) return null;
  return { clientEmail, privateKey, sheetId, range };
}

const b64url = (input) => Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

async function getAccessToken({ clientEmail, privateKey }) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(privateKey).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Google auth failed (${res.status}): ${data.error_description || data.error || "unknown"}`);
  return data.access_token;
}

async function appendRow(config, row) {
  const token = await getAccessToken(config);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.sheetId)}/values/${encodeURIComponent(config.range)}:append`
    + "?valueInputOption=RAW&insertDataOption=INSERT_ROWS"; // RAW: values are stored as text, never evaluated as formulas
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [row] }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sheets append failed (${res.status}): ${text.slice(0, 300)}`);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ ok: false, error: "Invalid request body." });
  }

  // Honeypot: bots fill the hidden "company" field. Pretend success, store nothing.
  if (body.company) return res.status(200).json({ ok: true });

  const { fields, lead } = validate(body);
  if (Object.keys(fields).length) {
    return res.status(400).json({ ok: false, error: "Please check your answers and try again.", fields });
  }

  const config = readConfig();
  if (!config) {
    console.error("[leads] Missing GOOGLE_SHEETS_CLIENT_EMAIL, GOOGLE_SHEETS_PRIVATE_KEY or GOOGLE_SHEET_ID");
    return res.status(500).json({ ok: false, error: "Lead storage is not configured." });
  }

  const row = [
    new Date().toISOString(),
    lead.name,
    lead.email,
    lead.phone,
    lead.objective,
    lead.budget === "Custom" ? `Custom: ${lead.budgetCustom}` : lead.budget,
    lead.locations.join(", "),
    lead.timeline,
    lead.fromUS,
  ];

  try {
    await appendRow(config, row);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[leads]", err.message);
    return res.status(502).json({ ok: false, error: "We couldn't save your brief right now. Please try again shortly." });
  }
};
