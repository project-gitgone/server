---
"@project-gitgone/server": patch
---

GitGone Cloud can again reset an instance, reset its access (sessions, CI tokens, key rotation required) and revoke the sessions of a member whose authorization was removed: the management routes were missing from the released server. Cloud login errors are logged, and an unreachable cloud is reported as such to the CLI.
