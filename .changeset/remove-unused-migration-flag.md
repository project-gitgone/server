---
"@project-gitgone/server": patch
---

Remove the unused `DB_ALLOW_MIGRATIONS_IN_PRODUCTION` variable: migrations always run when the server starts.
