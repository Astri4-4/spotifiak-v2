FROM node:24-slim
# ffmpeg converts the audio formats some players can't read (iOS: ogg, opus, webm).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
# yt-dlp, for YouTube videos added to podcasts: the standalone build (no Python), the
# latest release on purpose since YouTube changes often; rebuild the image to update.
ADD --chmod=755 https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux /usr/local/bin/yt-dlp
WORKDIR /app
COPY package*.json ./
# Retry: the npm cache mount keeps already-downloaded packages between attempts.
RUN --mount=type=cache,target=/root/.npm \
    for i in 1 2 3 4 5; do npm ci --prefer-offline && exit 0; echo "npm ci failed, retry $i"; done; exit 1
COPY . .
RUN npm run build
# Owned by node so a fresh Docker volume mounted there is writable.
RUN mkdir /podcasts /transcode && chown node:node /podcasts /transcode
# Unprivileged, as Kubernetes' restricted pod security requires (uid 1000).
USER node
# exec: node becomes PID 1 and gets SIGTERM directly (sh and npm don't forward it).
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/server.js"]
