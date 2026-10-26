-- CreateEnum
CREATE TYPE "SpotifyImportStatus" AS ENUM ('running', 'waiting', 'done', 'failed');

-- CreateEnum
CREATE TYPE "SpotifyImportTrackStatus" AS ENUM ('pending', 'matched', 'queued', 'not_found');

-- CreateTable
CREATE TABLE "SpotifyAccount" (
    "userId" TEXT NOT NULL,
    "spotifyUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpotifyAccount_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "SpotifyImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "spotifyPlaylistId" TEXT,
    "name" TEXT NOT NULL,
    "playlistId" TEXT,
    "status" "SpotifyImportStatus" NOT NULL DEFAULT 'running',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpotifyImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpotifyImportTrack" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "addedAt" TIMESTAMP(3),
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "album" TEXT,
    "isrc" TEXT,
    "deezerIsrc" TEXT,
    "status" "SpotifyImportTrackStatus" NOT NULL,
    "trackId" TEXT,

    CONSTRAINT "SpotifyImportTrack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpotifyImport_userId_createdAt_idx" ON "SpotifyImport"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SpotifyImportTrack_importId_position_idx" ON "SpotifyImportTrack"("importId", "position");

-- CreateIndex
CREATE INDEX "SpotifyImportTrack_status_idx" ON "SpotifyImportTrack"("status");

-- AddForeignKey
ALTER TABLE "SpotifyAccount" ADD CONSTRAINT "SpotifyAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpotifyImport" ADD CONSTRAINT "SpotifyImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpotifyImport" ADD CONSTRAINT "SpotifyImport_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpotifyImportTrack" ADD CONSTRAINT "SpotifyImportTrack_importId_fkey" FOREIGN KEY ("importId") REFERENCES "SpotifyImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
