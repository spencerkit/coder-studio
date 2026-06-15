---
"@spencer-kit/coder-studio": patch
---

Fix server startup failure when bundled web assets include `dev-browser-sw.js` by excluding the service worker from static file glob registration.
