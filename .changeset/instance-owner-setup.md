---
"@project-gitgone/server": patch
---

An instance is now initialized only once it has an active owner, so a member who signs in before the setup no longer blocks the creation of the administrator. On a GitGone Cloud instance, the owner of the organization becomes owner of the instance when signing in with the cloud (promotion only), and the password setup is closed. The welcome page always points to `gitgone login`.
