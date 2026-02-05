FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS build
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY server/package.json ./server/
COPY cli/package.json ./cli/

RUN pnpm install --frozen-lockfile

COPY server/ ./server/

WORKDIR /app/server
RUN node ace build

FROM base AS prod-deps
WORKDIR /app
COPY --from=build /app/server/build/package.json ./package.json
COPY --from=build /app/server/build/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --prod --frozen-lockfile

FROM base AS production
ENV NODE_ENV=production
WORKDIR /app

USER node

COPY --from=build --chown=node:node /app/server/build ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules

EXPOSE 3333
CMD ["node", "bin/server.js"]
