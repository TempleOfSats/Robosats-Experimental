export function generateRobotToken(length = 36): string {
  if (length <= 0) return "";

  return btoa(
    Array.from(crypto.getRandomValues(new Uint8Array(length * 2)))
      .map((byte) => String.fromCharCode(byte))
      .join("")
  )
    .replace(/[+/]/g, "")
    .substring(0, length);
}

export interface TokenEntropy {
  hasEnoughEntropy: boolean;
  bitsEntropy: number;
  shannonEntropy: number;
}

export function validateTokenEntropy(token: string): TokenEntropy {
  const charCounts: Record<string, number> = {};
  const length = token.length;
  let shannonEntropy = 0;

  for (let index = 0; index < length; index += 1) {
    const char = token.charAt(index);
    charCounts[char] = (charCounts[char] ?? 0) + 1;
  }

  Object.keys(charCounts).forEach((char) => {
    const probability = charCounts[char] / length;
    shannonEntropy -= probability * Math.log2(probability);
  });

  const uniqueChars = Object.keys(charCounts).length;
  const bitsEntropy = Math.log2(Math.pow(uniqueChars, length));
  const hasEnoughEntropy = bitsEntropy > 128 && shannonEntropy > 4;

  return { hasEnoughEntropy, bitsEntropy, shannonEntropy };
}
