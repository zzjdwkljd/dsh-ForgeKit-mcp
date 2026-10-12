// png.ts - tiny PNG helpers (no image library needed).

/** Read width/height from a PNG buffer (IHDR header). */
export function pngSize(png: Buffer): { width: number; height: number } {
  // PNG signature (8 bytes) + IHDR length (4) + "IHDR" (4) -> width/height as u32 BE.
  if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47) {
    return { width: 0, height: 0 };
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
