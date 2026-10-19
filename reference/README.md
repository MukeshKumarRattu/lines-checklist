# Server reference (not for Lovable to run)

The local test build of Lines Checklist runs a small Express server (`index.js`).
In Lovable this is replaced by Supabase tables + edge functions. These files are
here so the behaviour can be copied exactly:

| What | Where in `index.js` / `report.js` | Lovable equivalent |
|---|---|---|
| Maintenance tickets (open / closed, own photo copy) | `/api/maintenance` | table `lc_maintenance_tickets` |
| Investigations (`not-corrected`, `fake-log`) | `/api/investigations` | table `lc_investigations` |
| Submission kind `"supervisor"` (line = `"1,2"`, item ids `"<lineId>:<itemId>"`) | `POST /api/submissions` | allow the value in `lc_submissions.kind` |
| Daily report HTML (07:00 → 07:00, day 07–19 / night 19–07, only lines that were checked) | `report.js` `buildDailyReport` | edge function returning `{ subject, html }` |
| Report email (recipients on/off, test send, photos embedded) | `/api/email-settings`, `/api/email-report` | edge function + table `lc_email_settings` |
| Auto-send at 07:05 for the day just ended | `setInterval` at the end of `index.js` | scheduled edge function (cron `5 7 * * *`) |

The frontend only talks to the server through `src/lib/api.ts` — keep those
function names and shapes and rewrite their bodies against Supabase.
