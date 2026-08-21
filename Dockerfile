FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build

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

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS runtime

ARG APP_VERSION=0.1.0
ARG APP_RELEASE
ARG BUILD_COMMIT
ARG BUILD_TIMESTAMP
ENV NODE_ENV=production
ENV APP_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1
ENV APP_VERSION=$APP_VERSION
ENV APP_RELEASE=$APP_RELEASE
ENV BUILD_COMMIT=$BUILD_COMMIT
ENV BUILD_TIMESTAMP=$BUILD_TIMESTAMP
WORKDIR /app

RUN addgroup -S -g 10001 provider && adduser -S -u 10001 -G provider provider
COPY --from=build --chown=provider:provider /app/.next/standalone ./
COPY --from=build --chown=provider:provider /app/.next/static ./.next/static
COPY --from=build --chown=provider:provider /app/public ./public

USER provider
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const http=require('http');const host=new URL(process.env.BETTER_AUTH_URL).host;http.get({hostname:'127.0.0.1',port:3000,path:'/api/health',headers:{host}},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "server.js"]
