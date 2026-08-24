# Dedicated one-shot runtime for the isolated headless API team.
# Keep the same reviewed Node base digest as the main JHT image.
FROM node:22-bookworm-slim@sha256:d415caac2f1f77b98caaf9415c5f807e14bc8d7bdea62561ea2fef4fbd08a73c AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm install --global npm@11.10.1 \
    && npm ci --no-audit --no-fund

COPY src ./src
RUN npm exec tsc -- --noEmit false --rootDir src --outDir dist --declaration false --sourceMap false \
    && npm prune --omit=dev \
    && npm cache clean --force

FROM node:22-bookworm-slim@sha256:d415caac2f1f77b98caaf9415c5f807e14bc8d7bdea62561ea2fef4fbd08a73c

ENV NODE_ENV=production \
    NODE_OPTIONS=--no-warnings

WORKDIR /app

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node fixtures ./fixtures

USER node

ENTRYPOINT ["node", "dist/team-cli.js"]
