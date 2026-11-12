-- CreateTable
CREATE TABLE "TrackLyrics" (
    "trackId" TEXT NOT NULL,
    "synced" TEXT,
    "plain" TEXT,
    "instrumental" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackLyrics_pkey" PRIMARY KEY ("trackId")
);

-- AddForeignKey
ALTER TABLE "TrackLyrics" ADD CONSTRAINT "TrackLyrics_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
