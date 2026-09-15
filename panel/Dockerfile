FROM node:22-alpine AS build

WORKDIR /build
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/tsconfig.json ./shared/
COPY server/package.json server/tsconfig.json ./server/
COPY web/package.json web/tsconfig.json web/vite.config.ts ./web/
RUN npm ci

COPY shared/src ./shared/src
COPY server/src ./server/src
COPY web/src ./web/src
COPY web/index.html ./web/index.html
RUN npm run build && npm prune --omit=dev

FROM docker:cli AS docker-cli

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
COPY --from=build /build/package.json /build/package-lock.json ./
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/shared/package.json ./shared/package.json
COPY --from=build /build/shared/dist ./shared/dist
COPY --from=build /build/server/package.json ./server/package.json
COPY --from=build /build/server/dist ./server/dist
COPY --from=build /build/web/dist ./web/dist

USER 1000:1000
EXPOSE 8090
CMD ["node", "server/dist/index.js"]
