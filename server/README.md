# Backend boundary

This directory is reserved for a future backend; there is no executable server
yet. Once a stack is chosen, organize its code by responsibility:

```text
src/
  config/        Validated server environment settings
  routes/        HTTP endpoints
  middleware/    Session verification and request validation
  services/      Habit, entry, and photo operations
  db/            Connection and queries
```

The intended flow is browser → authenticated API → database. A managed backend
with enforced per-user access policies is another option; choose one approach
before implementation.

Initial operations should cover sessions, listing/creating/updating/deleting
habits, listing/upserting daily entries, and uploading/retrieving private photos.
Derive identity from the verified session, never a browser-supplied user ID.
Check ownership on every habit, entry, and photo read or write. Use the selected
authentication provider's supported session handling and credential storage.

Read secrets from the backend environment. Add a sanitized `.env.example` once
actual configuration names are known. Do not publicly serve this directory,
`database/`, or environment files in production.
