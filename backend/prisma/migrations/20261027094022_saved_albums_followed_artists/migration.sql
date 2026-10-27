-- CreateTable
CREATE TABLE "SavedAlbum" (
    "userId" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedAlbum_pkey" PRIMARY KEY ("userId","albumId")
);

-- CreateTable
CREATE TABLE "FollowedArtist" (
    "userId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "followedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowedArtist_pkey" PRIMARY KEY ("userId","artistId")
);

-- CreateIndex
CREATE INDEX "SavedAlbum_userId_savedAt_idx" ON "SavedAlbum"("userId", "savedAt");

-- CreateIndex
CREATE INDEX "FollowedArtist_userId_followedAt_idx" ON "FollowedArtist"("userId", "followedAt");

-- AddForeignKey
ALTER TABLE "SavedAlbum" ADD CONSTRAINT "SavedAlbum_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedAlbum" ADD CONSTRAINT "SavedAlbum_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowedArtist" ADD CONSTRAINT "FollowedArtist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowedArtist" ADD CONSTRAINT "FollowedArtist_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
