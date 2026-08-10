import { sha256 } from "js-sha256";
import { ROBO_ADJECTIVES, ROBO_NOUNS } from "@/domains/identity/generated/robonameData";

const maxNicknameLength = 18;

export function generateBrowserRoboname(hashId: string): string {
  let hash = hashId;
  for (let iteration = 0; iteration < 10_000; iteration += 1) {
    const nickname = nicknameForHash(hash);
    if (nickname.length <= maxNicknameLength) return nickname;
    hash = sha256(`${hash}42`);
  }
  return "";
}

function nicknameForHash(hash: string): string {
  const maxNumber = 999n;
  const nounCount = BigInt(ROBO_NOUNS.length);
  const poolSize = maxNumber * nounCount * BigInt(ROBO_ADJECTIVES.length);
  const nicknameId = (BigInt(`0x${hash}`) * poolSize) / (1n << 256n);
  const adjectiveId = nicknameId / (maxNumber * nounCount);
  const remainder = nicknameId - adjectiveId * maxNumber * nounCount;
  const nounId = remainder / maxNumber;
  const number = remainder - nounId * maxNumber;
  return `${ROBO_ADJECTIVES[Number(adjectiveId)]}${ROBO_NOUNS[Number(nounId)]}${number}`;
}
