/*
  Warnings:

  - You are about to drop the column `album` on the `Track` table. All the data in the column will be lost.
  - You are about to drop the column `albumArtist` on the `Track` table. All the data in the column will be lost.
  - You are about to drop the column `artist` on the `Track` table. All the data in the column will be lost.
  - You are about to drop the column `year` on the `Track` table. All the data in the column will be lost.
  - Added the required column `artistId` to the `Track` table without a default value. This is not possible if the table is not empty.
  - Added the required column `artistName` to the `Track` table without a default value. This is not possible if the table is not empty.

*/
-- Tracks gain required artist/album links that can't be derived in SQL.
-- Clear the index; the next library scan re-reads every file.
DELETE FROM "Track";

-- AlterTable
ALTER TABLE "Track" DROP COLUMN "album",
DROP COLUMN "albumArtist",
DROP COLUMN "artist",
DROP COLUMN "year",
ADD COLUMN     "albumId" TEXT,
ADD COLUMN     "artistId" TEXT NOT NULL,
ADD COLUMN     "artistName" TEXT NOT NULL,
ADD COLUMN     "indexVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Artist" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Artist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Album" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "year" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Album_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Artist_name_key" ON "Artist"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Album_artistId_title_key" ON "Album"("artistId", "title");

-- CreateIndex
CREATE INDEX "Track_albumId_idx" ON "Track"("albumId");

-- CreateIndex
CREATE INDEX "Track_artistId_idx" ON "Track"("artistId");

-- AddForeignKey
ALTER TABLE "Album" ADD CONSTRAINT "Album_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE SET NULL ON UPDATE CASCADE;
