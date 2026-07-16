import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { cn } from "@/lib/cn";

export function RobotAvatar({
  hashId,
  label,
  size = "md"
}: {
  hashId?: string | null;
  label?: string;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const hue = hashId ? parseInt(hashId.slice(0, 6), 16) % 360 : 38;
  const [avatarSrc, setAvatarSrc] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    if (!hashId) {
      setAvatarSrc("");
      return;
    }

    setAvatarSrc("");
    const preferredSize = size === "lg" || size === "xl" ? "large" : "small";
    const previewSize = preferredSize === "large" ? "small" : preferredSize;

    void import("@/domains/identity/roboidentitiesClient")
      .then(async ({ generateRobohash }) => {
        // Render a small deterministic avatar first, then upgrade it in place.
        const preview = await generateRobohash(hashId, previewSize);
        if (!cancelled) setAvatarSrc(preview);
        if (preferredSize === previewSize) return;
        const full = await generateRobohash(hashId, preferredSize);
        if (!cancelled) setAvatarSrc(full);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [hashId, size]);

  return (
    <div
      className={cn("robot-avatar", `robot-avatar-${size}`, avatarSrc ? "robot-avatar-ready" : "robot-avatar-loading")}
      style={avatarSrc ? {
        background: `radial-gradient(circle at 35% 25%, hsl(${hue} 76% 48%), hsl(${(hue + 42) % 360} 70% 27%))`
      } : undefined}
      aria-label={label || "Robot avatar"}
      title={label || undefined}
      aria-busy={!avatarSrc}
    >
      {avatarSrc ? (
        <img src={avatarSrc} alt="" />
      ) : (
        <span className="robot-avatar-placeholder" aria-hidden="true">
          <Bot />
        </span>
      )}
    </div>
  );
}
