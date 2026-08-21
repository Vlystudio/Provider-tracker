FROM node:22-alpine AS build

ARG APP_VERSION=0.1.0
ARG APP_RELEASE
ARG BUILD_COMMIT
ARG BUILD_TIMESTAMP
ENV APP_VERSION=$APP_VERSION
ENV APP_RELEASE=$APP_RELEASE
ENV BUILD_COMMIT=$BUILD_COMMIT
ENV BUILD_TIMESTAMP=$BUILD_TIMESTAMP
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime

ARG APP_VERSION=0.1.0
ARG APP_RELEASE
ARG BUILD_COMMIT
ARG BUILD_TIMESTAMP
ENV NODE_ENV=production
ENV APP_ENV=production
ENV APP_VERSION=$APP_VERSION
ENV APP_RELEASE=$APP_RELEASE
ENV BUILD_COMMIT=$BUILD_COMMIT
ENV BUILD_TIMESTAMP=$BUILD_TIMESTAMP
WORKDIR /app

RUN addgroup -S provider && adduser -S provider -G provider
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --omit=peer && npm cache clean --force
COPY --from=build --chown=provider:provider /app/.next ./.next
COPY --from=build --chown=provider:provider /app/public ./public
COPY --from=build --chown=provider:provider /app/next.config.ts ./next.config.ts
COPY --from=build --chown=provider:provider /app/src/server/config.ts ./src/server/config.ts

USER provider
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "node_modules/next/dist/bin/next", "start"]
