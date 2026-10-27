-- CreateEnum
CREATE TYPE "EpisodeStatus" AS ENUM ('ready', 'queued', 'downloading', 'failed');

-- AlterTable
ALTER TABLE "Podcast" ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "PodcastEpisode" ADD COLUMN     "error" TEXT,
ADD COLUMN     "filePath" TEXT,
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "status" "EpisodeStatus" NOT NULL DEFAULT 'ready';

-- AddForeignKey
ALTER TABLE "Podcast" ADD CONSTRAINT "Podcast_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
