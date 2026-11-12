-- AlterTable
ALTER TABLE "User" ADD COLUMN "weeklyRecapAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Play" ADD COLUMN "placeCell" TEXT;

-- CreateTable
CREATE TABLE "Skip" (
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "skippedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Skip_pkey" PRIMARY KEY ("userId","trackId")
);

-- CreateTable
CREATE TABLE "DuelVote" (
    "userId" TEXT NOT NULL,
    "friendId" TEXT NOT NULL,
    "week" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "liked" BOOLEAN NOT NULL,
    "votedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuelVote_pkey" PRIMARY KEY ("userId","friendId","week")
);

-- CreateIndex
CREATE INDEX "DuelVote_friendId_idx" ON "DuelVote"("friendId");

-- AddForeignKey
ALTER TABLE "Skip" ADD CONSTRAINT "Skip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Skip" ADD CONSTRAINT "Skip_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuelVote" ADD CONSTRAINT "DuelVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuelVote" ADD CONSTRAINT "DuelVote_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
