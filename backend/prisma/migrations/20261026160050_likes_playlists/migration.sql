/*
  Warnings:

  - The primary key for the `PlaylistTrack` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Added the required column `updatedAt` to the `Playlist` table without a default value. This is not possible if the table is not empty.
  - The required column `id` was added to the `PlaylistTrack` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- AlterTable
ALTER TABLE "Playlist" ADD COLUMN     "description" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "PlaylistTrack" DROP CONSTRAINT "PlaylistTrack_pkey",
-- Existing rows (none expected) get a random id; new rows get a cuid from Prisma.
ADD COLUMN     "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
ALTER COLUMN "position" SET DATA TYPE DOUBLE PRECISION,
ADD CONSTRAINT "PlaylistTrack_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE INDEX "Like_userId_likedAt_idx" ON "Like"("userId", "likedAt");

-- CreateIndex
CREATE INDEX "Playlist_ownerId_idx" ON "Playlist"("ownerId");

-- CreateIndex
CREATE INDEX "PlaylistTrack_playlistId_position_idx" ON "PlaylistTrack"("playlistId", "position");

-- Defaults above only served existing rows.
ALTER TABLE "Playlist" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "PlaylistTrack" ALTER COLUMN "id" DROP DEFAULT;
