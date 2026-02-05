# GitGone

GitGone is a tool designed to manage and synchronize secrets securely across teams and environments, with a focus on ease of use and developer experience.

## Project Structure

- **[server/](./server)**: The core API built with AdonisJS. It handles user authentication, team management, and secure storage of encrypted secrets.
- **[cli/](./cli)**: The command-line interface for developers to interact with GitGone, push/pull secrets, and manage project keys.

## Key Features

- **End-to-End Encryption**: Secrets are encrypted on the client side before being sent to the server.
- **Team Management**: Robust RBAC (Role-Based Access Control) for teams and projects.
- **CLI-First**: Optimized for developer workflows.
- **Version History**: Full history of secret changes with rollback capabilities.
- **Self-Hostable**: Easily deployable with Docker.

## Quick Start

Refer to the individual `README.md` files in the `server/` and `cli/` directories for detailed instructions on how to set up and run each component.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
