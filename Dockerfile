FROM node:22-alpine AS base
RUN npm install -g pnpm

FROM base AS build
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY server/package.json ./server/
COPY cli/package.json ./cli/

RUN pnpm install --filter gitgone-server --frozen-lockfile

COPY server/ ./server/
WORKDIR /app/server
RUN node ace build

FROM base AS production
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/cli/package.json ./cli/
COPY --from=build /app/server/build ./server

WORKDIR /app/server
RUN pnpm install --prod --frozen-lockfile

EXPOSE 3333
CMD ["node", "bin/server.js"]
