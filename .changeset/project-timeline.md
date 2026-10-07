---
"@project-gitgone/server": minor
---

New `GET /api/projects/:id/timeline` endpoint: the versions of every environment of a project, newest first, with key rotations and environment creations, limited to the environments the user can read the history of. Rollback pushes now record the restored version (`rollbackOf`) on the new version.
