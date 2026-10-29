-- AlterTable
ALTER TABLE "Playlist" ADD COLUMN     "public" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Playlist_public_updatedAt_idx" ON "Playlist"("public", "updatedAt");
