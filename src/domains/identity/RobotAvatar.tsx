import { memo, useEffect, useState } from "react";
import { RobotIcon } from "@/components/ui/robotIcon";
import { cn } from "@/lib/cn";

export const RobotAvatar = memo(function RobotAvatar({
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
    void import("@/domains/identity/roboidentitiesClient")
      .then(({ generateRobohash }) => generateRobohash(hashId))
      .then((avatar) => {
        if (!cancelled) setAvatarSrc(avatar);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [hashId]);

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
          <RobotIcon className="robot-avatar-placeholder-icon" />
        </span>
      )}
    </div>
  );
});
