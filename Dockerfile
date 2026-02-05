FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS build
WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN node ace build

FROM base AS prod-deps
WORKDIR /app

COPY --from=build /app/build/package.json ./package.json
COPY --from=build /app/build/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --prod --frozen-lockfile

FROM base AS production
ENV NODE_ENV=production
WORKDIR /app

USER node

COPY --from=build --chown=node:node /app/build ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node scripts/ ./scripts/
RUN chmod +x scripts/start.sh

EXPOSE 3333
CMD ["./scripts/start.sh"]
