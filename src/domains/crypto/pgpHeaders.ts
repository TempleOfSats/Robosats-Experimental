export function escapeArmoredKeyForHeader(key: string): string {
  return key.split("\n").join("\\");
}
