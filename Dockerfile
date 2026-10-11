FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
FROM dependencies AS build
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 UPLOAD_DIR=/data/uploads
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/db/migrations ./db/migrations
COPY --from=build --chown=node:node /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=build --chown=node:node /app/scripts/resume-worker.mjs ./scripts/resume-worker.mjs
COPY --from=build --chown=node:node /app/scripts/mcp-local-gateway.mjs ./scripts/mcp-local-gateway.mjs
COPY --from=build --chown=node:node /app/scripts/mcp-stdio.mjs ./scripts/mcp-stdio.mjs
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
