export function messageContainsRobotToken(message: string, token: string | undefined): boolean {
  const secret = token?.trim();
  if (!secret) return false;

  if (message.includes(secret)) return true;

  // Catch a token pasted with line breaks or spaces while avoiding transformations
  // that could make ordinary chat text look like a secret.
  return message.replace(/\s+/g, "").includes(secret.replace(/\s+/g, ""));
}
