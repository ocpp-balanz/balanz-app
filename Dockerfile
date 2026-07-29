# syntax=docker/dockerfile:1

# ---- Build the static web app ----
# Node 22, not 20: @capacitor/cli declares engines.node ">=22.0.0", so an
# older base emits EBADENGINE warnings for the whole install. It's only a
# devDependency and unused by the web build itself, but `npm ci` installs
# dev dependencies (Vite among them), so the constraint still applies here.
# Keep this in step with the `engines.node` field in package.json.
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Baked in as the build-time default backend address only - just like the
# native Capacitor builds (see README's "Server address" section), it stays
# overridable afterwards from the in-app Settings panel without a rebuild.
ARG VITE_API_BASE_URL=http://localhost:8000
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build

# ---- Serve the build output ----
FROM nginx:alpine AS serve

COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
