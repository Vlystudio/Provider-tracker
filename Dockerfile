FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV APP_ENV=production
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
CMD ["npm", "start"]
