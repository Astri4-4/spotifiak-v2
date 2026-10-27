FROM node:24-slim
WORKDIR /app
COPY package*.json ./
# Retry: the npm cache mount keeps already-downloaded packages between attempts.
RUN --mount=type=cache,target=/root/.npm \
    for i in 1 2 3 4 5; do npm ci --prefer-offline && exit 0; echo "npm ci failed, retry $i"; done; exit 1
COPY . .
RUN npm run build
# Unprivileged, as Kubernetes' restricted pod security requires (uid 1000).
USER node
# exec: node becomes PID 1 and gets SIGTERM directly (sh and npm don't forward it).
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/server.js"]
