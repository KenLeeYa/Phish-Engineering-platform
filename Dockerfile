FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system --gid 10001 sea \
  && useradd --system --uid 10001 --gid sea --home-dir /nonexistent --shell /usr/sbin/nologin sea \
  && mkdir /tenant \
  && chown sea:sea /tenant

COPY --from=build --chown=sea:sea /app/node_modules ./node_modules
COPY --from=build --chown=sea:sea /app/dist ./dist
COPY --chown=sea:sea package.json ./
COPY --chown=sea:sea public ./public

USER 10001:10001
EXPOSE 4280
CMD ["node", "dist/index.js"]
