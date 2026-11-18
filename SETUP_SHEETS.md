# Connecting the Property Brief form to Google Sheets

Every "Your Israel Property Brief" submission goes to `POST /api/leads` (`api/leads.js`). The function validates it and adds one row to your Google Sheet. It runs as a Vercel Serverless Function next to the static `index.html` and needs no npm packages and no build step.

## 1. Create the sheet

1. Create a new Google Sheet, for example "Gesher Leads".
2. Paste these headers into row 1, columns A to I:

   | Timestamp | Name | Email | Phone | Objective | Budget | Locations | Timeline | Purchasing from US |
   |---|---|---|---|---|---|---|---|---|

3. Copy the sheet ID from the URL: `https://docs.google.com/spreadsheets/d/`**`<SHEET_ID>`**`/edit`

## 2. Create a Google Cloud service account (free)

1. Go to <https://console.cloud.google.com/> and create a project (or pick an existing one).
2. **APIs & Services → Library**: search for **Google Sheets API** and click **Enable**.
3. **APIs & Services → Credentials → Create credentials → Service account**. Name it something like `gesher-leads`. It does not need any project roles, so click **Done**.
4. Open the service account, go to **Keys → Add key → Create new key → JSON**, and download the file. Keep it private and never commit it.

## 3. Share the sheet with the service account

In the Google Sheet, click **Share** and add the service account's email (the `client_email` in the JSON file, such as `gesher-leads@your-project.iam.gserviceaccount.com`) as an **Editor**. Turn off "Notify people".

## 4. Set the environment variables

| Variable | Value |
|---|---|
| `GOOGLE_SHEETS_CLIENT_EMAIL` | `client_email` from the JSON key |
| `GOOGLE_SHEETS_PRIVATE_KEY` | `private_key` from the JSON key, the whole value including `-----BEGIN PRIVATE KEY-----` and the `\n` sequences |
| `GOOGLE_SHEET_ID` | The ID from step 1 |
| `GOOGLE_SHEET_RANGE` | *(optional)* Defaults to `A1`, which is the first tab. Use `Leads!A1` to write to a tab named "Leads". |

**On Vercel:** go to **Project → Settings → Environment Variables**, add each variable for Production (and Preview if you like), then **redeploy**. When pasting the private key into Vercel, paste the value without the surrounding quotes. Either the literal `\n` sequences or real line breaks will work.

**Locally:** copy `.env.example` to `.env`, fill it in, and run `npx vercel dev`. Opening `index.html` straight from disk won't work because the `/api` route only exists under Vercel.

## 5. Test it

Submit the form on the deployed site, and a new row should appear within a few seconds. If it doesn't, open **Vercel → Project → Logs** and look for lines starting with `[leads]`:

| Log message | Fix |
|---|---|
| `Missing GOOGLE_SHEETS_...` | An env var isn't set, or you didn't redeploy after adding it. |
| `Google auth failed (400): invalid_grant` | The private key is malformed or doesn't match the client email. Paste it again. |
| `Sheets append failed (403)` | The sheet isn't shared with the service account, or the Sheets API isn't enabled. |
| `Sheets append failed (400) ... Unable to parse range` | `GOOGLE_SHEET_RANGE` names a tab that doesn't exist. |

## Notes

- **Email notifications:** the form also sends a best-effort email through Web3Forms, using `WEB3FORMS_ACCESS_KEY` in `index.html`. If either the sheet or the email succeeds, the visitor sees a success message, so a lead isn't lost while one of them is misconfigured. Set the key to `""` to turn emails off.
- **Security:** rows are written with `valueInputOption=RAW`, so anything a visitor types is stored as plain text and never runs as a spreadsheet formula. A hidden honeypot field silently drops basic bot submissions.
- **Booking link:** set `BOOKING_URL` in `index.html` to a Calendly, Cal.com or Google Calendar appointment page. The "Schedule an introductory call" buttons then open it in a modal. While it's empty, they scroll to the Property Brief form.
