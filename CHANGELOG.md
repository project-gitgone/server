# @project-gitgone/server

## 26.10.8

### Patch Changes

- [`a9e6a4a`](https://github.com/project-gitgone/server/commit/a9e6a4a42cf0a3928aba40c371be0742b6579f28) Thanks [@Asuniia](https://github.com/Asuniia)! - Error messages point to the new CLI command names: `gitgone key share` and `gitgone account password`.

- [`9361017`](https://github.com/project-gitgone/server/commit/9361017ced8a3563a6efba00d0527fa4c472b3fe) Thanks [@Asuniia](https://github.com/Asuniia)! - An instance is now initialized only once it has an active owner, so a member who signs in before the setup no longer blocks the creation of the administrator. On a GitGone Cloud instance, the owner of the organization becomes owner of the instance when signing in with the cloud (promotion only), and the password setup is closed. The welcome page always points to `gitgone login`.

- [`a59675b`](https://github.com/project-gitgone/server/commit/a59675bcd706a03d8652b16be9e67b20b1f8b14a) Thanks [@Asuniia](https://github.com/Asuniia)! - Remove the unused `DB_ALLOW_MIGRATIONS_IN_PRODUCTION` variable: migrations always run when the server starts.

## 26.10.7

### Patch Changes

- [#4](https://github.com/project-gitgone/server/pull/4) [`f9eba26`](https://github.com/project-gitgone/server/commit/f9eba2696f21137460f2c3a437ebd9d587ce0b4e) Thanks [@Asuniia](https://github.com/Asuniia)! - New status-style home page showing whether the instance is healthy, needs setup or has a problem, with the CLI commands to copy. It can be hidden with `STATUS_PAGE=false`. New endpoints for the cloud console: team listing, a user's permissions on a team and a project, and linking a cloud member. Development setup with Postgres on port 5433 and a dedicated test database on 5434.
