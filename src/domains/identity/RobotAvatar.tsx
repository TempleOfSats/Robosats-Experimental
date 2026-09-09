import { memo, useEffect, useState } from "react";
import { RobotIcon } from "@/components/ui/robotIcon";
import { subscribeRefreshIntents } from "@/domains/transport/refreshIntents";
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
  const [downloadFailed, setDownloadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setDownloadFailed(false);
    if (!hashId) {
      setAvatarSrc("");
      return;
    }

    setAvatarSrc("");
    void import("@/domains/identity/roboavatarClient")
      .then(({ generateRobohash }) => generateRobohash(hashId))
      .then(
        (avatar) => {
          if (!cancelled) setAvatarSrc(avatar);
        },
        () => {
          if (!cancelled) setDownloadFailed(true);
        }
      );

    return () => {
      cancelled = true;
    };
  }, [hashId, attempt]);

  // A robot whose art failed to arrive is an avatar the user is looking at, so it
  // claims one download per app resume, focus, or Tor reconnect. Each failed avatar
  // owns its subscription: nothing is queued for art nobody is displaying.
  useEffect(() => {
    if (!downloadFailed) return undefined;
    return subscribeRefreshIntents(() => setAttempt((current) => current + 1));
  }, [downloadFailed]);

  return (
    <div
      className={cn("robot-avatar", `robot-avatar-${size}`, avatarSrc ? "robot-avatar-ready" : "robot-avatar-loading")}
      style={avatarSrc ? {
        background: `radial-gradient(circle at 35% 25%, hsl(${hue} 76% 48%), hsl(${(hue + 42) % 360} 70% 27%))`
      } : undefined}
      aria-label={label || "Robot avatar"}
      title={label || undefined}
      aria-busy={avatarSrc || downloadFailed ? undefined : true}
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
