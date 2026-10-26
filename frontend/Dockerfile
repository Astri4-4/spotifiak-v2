FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
# Retry: the npm cache mount keeps already-downloaded packages between attempts.
RUN --mount=type=cache,target=/root/.npm \
    for i in 1 2 3 4 5; do npm ci --prefer-offline && exit 0; echo "npm ci failed, retry $i"; done; exit 1
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
