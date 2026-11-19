FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN mkdir -p /app/model-cache && chown -R node:node /app

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm ONNXRUNTIME_NODE_INSTALL=skip npm ci --no-audit --no-fund

FROM dependencies AS build
COPY next.config.ts tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM base AS production-dependencies
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm ONNXRUNTIME_NODE_INSTALL=skip npm ci --omit=dev --no-audit --no-fund
ENV NODE_ENV=production

FROM production-dependencies AS application
COPY next.config.ts ./
COPY public ./public
COPY --from=build --chown=node:node /app/.next ./.next
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]

FROM production-dependencies AS worker
COPY src/server ./src/server
COPY worker ./worker
USER node
CMD ["node", "worker/index.mjs"]
