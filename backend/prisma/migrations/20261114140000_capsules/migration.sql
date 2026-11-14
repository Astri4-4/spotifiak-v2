-- CreateTable
CREATE TABLE "Capsule" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "message" TEXT,
    "openAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "Capsule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Capsule_toId_openAt_idx" ON "Capsule"("toId", "openAt");

-- CreateIndex
CREATE INDEX "Capsule_fromId_idx" ON "Capsule"("fromId");

-- CreateIndex
CREATE INDEX "Capsule_deliveredAt_openAt_idx" ON "Capsule"("deliveredAt", "openAt");

-- AddForeignKey
ALTER TABLE "Capsule" ADD CONSTRAINT "Capsule_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Capsule" ADD CONSTRAINT "Capsule_toId_fkey" FOREIGN KEY ("toId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Capsule" ADD CONSTRAINT "Capsule_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
