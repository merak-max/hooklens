FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8787 WEB_DIST=/app/apps/web/dist HOOKLENS_DATA_FILE=/app/data/hooklens.json
RUN addgroup -S hooklens && adduser -S hooklens -G hooklens && mkdir -p /app/data && chown hooklens:hooklens /app/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
USER hooklens
EXPOSE 8787
CMD ["node", "apps/api/dist/server.js"]
