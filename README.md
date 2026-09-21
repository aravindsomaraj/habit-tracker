# Habit Tracker

Track habits. Author: Madhav Dih Nair.

## Structure

```text
index.html                 Page markup and script entry points
CNAME                      Existing custom-domain configuration
assets/
  css/styles.css           Styling
  js/app.js                State, calculations, views, and event handlers
  js/storage.js            Persistence functions
  images/                  Cat mood illustrations
server/                    Future authenticated API (see README)
database/
  README.md                Data model and integration plan
  migrations/              Future versioned schema changes
```

The frontend remains framework-free. Keeping `index.html` at the root preserves
its static hosting layout. Classic scripts load storage functions before the
application; existing inline event handlers require global application functions.

## Run locally

From this directory, run `python3 -m http.server 8000` and open
http://localhost:8000. This serves the static frontend only.

## Current storage

Login and a standalone database are **not implemented yet**. The original code
uses `window.claude.use('db')`, `window.claude.use('assets')`, and `/_blob/` photo
URLs. These host-provided services are not included in this repository. On normal
static hosting, habits and entries disappear on reload and photo uploads are
unavailable. Only the theme preference uses browser local storage.

`assets/js/storage.js` isolates persistence, but still shares state with
`app.js`. Photo upload handling and host-specific photo URLs remain in `app.js`
and must also be updated when introducing file storage.

## Next step

Choose the database and authentication provider, then follow the
[database plan](database/README.md) and [backend boundary](server/README.md).
A static host can serve the frontend; a custom API needs a backend runtime.
Keep credentials on the backend. Everything in HTML and `assets/` is public.
Publish only frontend files when deploying alongside backend code.
