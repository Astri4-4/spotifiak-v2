-- AlterTable
ALTER TABLE "Track" ADD COLUMN "genre" TEXT;

-- CreateIndex
CREATE INDEX "Track_genre_idx" ON "Track"("genre");

-- CreateIndex
CREATE INDEX "Play_trackId_idx" ON "Play"("trackId");
