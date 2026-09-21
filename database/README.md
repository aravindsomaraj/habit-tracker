# Database integration plan

No engine or authentication provider has been selected. This proposed model
maps the existing app to persistent, per-user data.

| Entity | Data and constraints |
| --- | --- |
| User/profile | Authentication-provider user ID, optional display name, creation timestamp. Credentials belong to the auth provider. |
| Habit | ID, owner ID, name, emoji, template type, unit, target, duration, start date, ramp flag, metric label, creation timestamp. |
| Entry | Habit ID, date, done flag, value, metric, photo reference, note, update timestamp. Unique per habit/date. |
| Photo | ID, owner ID, habit/entry association, private object-storage key, content type, size, creation timestamp. |

Preserve the existing payload mapping: habits use `days`, `start`, `ramp`,
`metric`, and `createdAt`; entries use `done`, `value`, `metric`, `photo`, `note`,
and `ts`. Inspect `createHabit()` in `assets/js/app.js` for the complete habit
payload. Numeric entry values may be null. Calendar keys are local dates in
`YYYY-MM-DD` format, not UTC timestamps.

Enforce foreign keys and one entry per habit/date. Index habit ownership and
habit/date queries. Delete entries when deleting a habit and arrange cleanup of
its photos. Store image bytes in private object storage, with database references.

## Integration sequence

1. Select authentication, database, and backend hosting.
2. Add executable, versioned migrations in `migrations/`, verified sessions, and
   per-user authorization before exposing data endpoints.
3. Replace `boot`, `saveHabit`, `saveEntry`, and `removeHabit` in
   `assets/js/storage.js`. Replace subscriptions with the chosen refresh mechanism.
   Await writes and surface failures; the original code ignores some save errors.
4. Replace `ASSETS.upload`, `ASSETS.delete`, and `/_blob/` URLs with the chosen
   private file-storage flow. Validate uploads on the backend.
5. Add login/logout UI. Clear habits, entries, selection, and subscriptions on
   logout or account changes. Make importing temporary guest data explicit.
6. Verify persistence after reload, expired sessions, failed writes, photo
   cleanup, and that one account cannot access another account's data.

Add ordered schema migrations after selecting the tooling, and document local
and deployment commands. Do not commit live databases, backups, or user data.
