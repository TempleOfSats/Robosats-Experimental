export function escapeArmoredKeyForHeader(key: string): string {
  return key.replace(/\r\n?/g, "\n").replace(/\n/g, "\\");
}
