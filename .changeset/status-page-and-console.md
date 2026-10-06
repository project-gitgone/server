---
"@project-gitgone/server": patch
---

New status-style home page showing whether the instance is healthy, needs setup or has a problem, with the CLI commands to copy. It can be hidden with `STATUS_PAGE=false`. New endpoints for the cloud console: team listing, a user's permissions on a team and a project, and linking a cloud member. Development setup with Postgres on port 5433 and a dedicated test database on 5434.
