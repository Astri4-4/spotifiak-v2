FROM node:24-slim
WORKDIR /app
COPY package*.json ./
# Retry: the npm cache mount keeps already-downloaded packages between attempts.
RUN --mount=type=cache,target=/root/.npm \
    for i in 1 2 3 4 5; do npm ci --prefer-offline && exit 0; echo "npm ci failed, retry $i"; done; exit 1
COPY . .
RUN npm run build
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
