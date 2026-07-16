const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,./:;<=>?@[]^_`{|}~\"";

export function hexToBase91(hex: string): string {
  const bytes = hex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? [];
  let accumulator = 0;
  let bits = 0;
  let output = "";

  for (const byte of bytes) {
    accumulator |= byte << bits;
    bits += 8;

    if (bits > 13) {
      let value = accumulator & 8191;
      if (value > 88) {
        accumulator >>= 13;
        bits -= 13;
      } else {
        value = accumulator & 16383;
        accumulator >>= 14;
        bits -= 14;
      }
      output += alphabet[value % 91] + alphabet[Math.floor(value / 91)];
    }
  }

  if (bits > 0) {
    output += alphabet[accumulator % 91];
    if (bits > 7 || accumulator > 90) {
      output += alphabet[Math.floor(accumulator / 91)];
    }
  }

  return output;
}
