// Profile pictures are resized here: the server stores what it gets (1 MB at most).
const AVATAR_PX = 256
const JPEG_QUALITY = 0.85

/** The centered square of a `width`×`height` picture: [x, y, side]. */
export function squareCrop(width: number, height: number): [number, number, number] {
  const side = Math.min(width, height)
  return [Math.round((width - side) / 2), Math.round((height - side) / 2), side]
}

/** A 256 px square JPEG of the picture's center. */
export async function resizeAvatar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const [x, y, side] = squareCrop(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = AVATAR_PX
  canvas.getContext('2d')!.drawImage(bitmap, x, y, side, side, 0, 0, AVATAR_PX, AVATAR_PX)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Image illisible'))), 'image/jpeg', JPEG_QUALITY),
  )
}
