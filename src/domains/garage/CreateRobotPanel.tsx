import { useEffect, useRef, useState } from "react";
import { Check, Copy, Dices, Download, Info, KeyRound, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { RobotAvatar } from "@/domains/identity/RobotAvatar";
import { deriveRobotIdentity, type RobotIdentity } from "@/domains/identity/robotIdentity";
import { useGarageStore } from "@/domains/garage/garageStore";
import { requestRobotDataRefresh } from "@/domains/garage/robotDataRefresh";
import { generateRobotToken, isProFleetToken } from "@/domains/garage/token";
import { downloadRobotTokenBackup } from "@/domains/garage/tokenBackup";
import { writeClipboard } from "@/lib/clipboard";
import { playHaptic } from "@/lib/haptics";

type WizardStep = "start" | "recover" | "backup" | "identity";

export function CreateRobotPanel({
  onComplete,
  onFleetRecovery,
  onProfile
}: {
  onComplete?: () => void;
  onFleetRecovery?: (fleetKey: string) => void;
  onProfile?: () => void;
}) {
  const navigate = useNavigate();
  const addSlot = useGarageStore((state) => state.addSlot);
  const updateSlotIdentityDetails = useGarageStore((state) => state.updateSlotIdentityDetails);
  const [step, setStep] = useState<WizardStep>("start");
  const [token, setToken] = useState("");
  const [draftIdentity, setDraftIdentity] = useState<RobotIdentity | null>(null);
  const [draftNickname, setDraftNickname] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const latestToken = useRef("");

  useEffect(() => {
    // Load the renderer before the identity step opens.
    const timer = window.setTimeout(() => {
      void import("@/domains/identity/roboavatarClient").catch(() => undefined);
    }, 180);
    return () => window.clearTimeout(timer);
  }, []);

  const hasToken = token.trim().length > 0;
  const robotNameIsResolving = draftIdentity ? draftNickname === fallbackRobotName(draftIdentity.hashId) : false;

  const updateToken = (nextToken: string) => {
    latestToken.current = nextToken;
    setToken(nextToken);
    setDraftIdentity(null);
    setDraftNickname("");
    setCopied(false);
    setError("");
  };

  const generateToken = () => {
    const nextToken = generateRobotToken();
    const identity = deriveRobotIdentity(nextToken);
    const fallbackName = fallbackRobotName(identity.hashId);
    latestToken.current = nextToken;
    prewarmRobotAvatar(identity.hashId);
    setToken(nextToken);
    setDraftIdentity(identity);
    setDraftNickname(fallbackName);
    setCopied(false);
    setError("");
    setStep("backup");
    void resolveRobotName(identity.hashId, fallbackName).then((nickname) => {
      if (latestToken.current === nextToken) setDraftNickname(nickname);
    });
  };

  const continueToIdentity = () => {
    const cleanToken = token.trim();
    latestToken.current = cleanToken;
    if (!cleanToken) {
      setError("Enter a robot token first.");
      return;
    }
    if (isProFleetToken(cleanToken)) {
      if (onFleetRecovery) onFleetRecovery(cleanToken);
      else setError("This is a Fleet recovery key. Restore it from Pro Desk.");
      return;
    }

    const identity = deriveRobotIdentity(cleanToken);
    const fallbackName = fallbackRobotName(identity.hashId);
    setDraftIdentity(identity);
    setDraftNickname(fallbackName);
    setError("");
    setStep("identity");
    prewarmRobotAvatar(identity.hashId);

    void resolveRobotName(identity.hashId, fallbackName).then((nickname) => {
      setDraftNickname((current) => (current === fallbackName ? nickname : current));
    });
  };

  const saveRobot = async (): Promise<boolean> => {
    const cleanToken = token.trim();
    const identity = draftIdentity ?? deriveRobotIdentity(cleanToken);
    const fallbackName = fallbackRobotName(identity.hashId);
    const nickname = draftNickname || fallbackName;
    setSaving(true);
    try {
      addSlot({
        ...identity,
        nickname,
        managedBy: undefined,
        earnedRewards: 0,
        robots: {
          local: {
            token: cleanToken,
            shortAlias: "local",
            nostrPubKey: identity.nostrPubKey,
            tokenSHA256: identity.tokenSHA256,
            earnedRewards: 0
          }
        }
      });
      finalizeRobotSlot(cleanToken, identity.hashId, nickname, updateSlotIdentityDetails);
      playHaptic("success");
      return true;
    } catch {
      playHaptic("reject");
      setError("Could not create local encryption keys. Try again.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const finishRobotSetup = async () => {
    const saved = await saveRobot();
    if (!saved) return;
    requestRobotDataRefresh();
    onProfile?.();
    if (onComplete) onComplete();
    else navigate("/garage");
  };

  const copyToken = async () => {
    if (!token) return;
    try {
      await writeClipboard(token);
      setCopied(true);
      setError("");
    } catch {
      setCopied(false);
      setError("Clipboard access is unavailable. Use the download backup instead.");
    }
  };

  const downloadToken = async () => {
    const cleanToken = token.trim();
    if (!cleanToken) return;
    const identity = draftIdentity ?? deriveRobotIdentity(cleanToken);
    const fallbackName = fallbackRobotName(identity.hashId);
    const currentName = draftIdentity?.hashId === identity.hashId && draftNickname ? draftNickname : fallbackName;
    const robotName =
      currentName === fallbackName ? await resolveRobotName(identity.hashId, fallbackName) : currentName;
    if (latestToken.current !== cleanToken) return;
    setDraftIdentity(identity);
    setDraftNickname(robotName);
    downloadRobotTokenBackup(cleanToken, robotName);
  };

  return (
    <div className="robot-wizard robot-setup-surface" aria-label="Robot setup">
      {step === "start" ? (
        <section className="robot-setup-panel robot-setup-start" aria-labelledby="create-robot-title">
          <div className="robot-setup-copy">
            <h3 id="create-robot-title">Create a new robot</h3>
            <p>Your robot is the identity you use to trade. We’ll generate its recovery token, name, and avatar.</p>
          </div>
          <Button className="robot-setup-primary" onClick={generateToken} size="lg">
            <Dices size={18} />
            Create my robot
          </Button>
          <Button className="robot-setup-secondary" onClick={() => setStep("recover")} variant="ghost">
            <KeyRound size={17} />
            Restore an existing robot
          </Button>
        </section>
      ) : null}

      {step === "recover" ? (
        <section className="robot-setup-panel token-review-step" aria-labelledby="restore-robot-title">
          <div className="robot-setup-copy">
            <h3 id="restore-robot-title">Restore your robot</h3>
            <p>Paste the recovery token you saved when the robot was created.</p>
          </div>
          <TokenInput token={token} setToken={updateToken} />
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="wizard-actions robot-setup-actions">
            <Button
              variant="ghost"
              onClick={() => {
                updateToken("");
                setStep("start");
              }}
            >
              Back
            </Button>
            <Button onClick={continueToIdentity} disabled={!hasToken}>
              <Check size={17} />
              Continue to identity
            </Button>
          </div>
        </section>
      ) : null}

      {step === "backup" ? (
        <section className="robot-setup-panel token-review-step" aria-labelledby="backup-robot-title">
          <div className="robot-setup-copy">
            <h3 id="backup-robot-title">Save your recovery token</h3>
            <p>This is the only way back to your robot. Nobody can reset it for you.</p>
          </div>
          <div className="token-alert">
            <Info size={18} />
            <p>Store the token somewhere private before continuing.</p>
          </div>
          <TokenInput token={token} setToken={updateToken} readOnly />
          <div className="robot-backup-actions">
            <Button variant="secondary" onClick={() => void downloadToken()}>
              <Download size={17} />
              Download backup
            </Button>
            <Button variant="secondary" onClick={() => void copyToken()}>
              <Copy size={17} />
              {copied ? "Copied" : "Copy token"}
            </Button>
          </div>
          {copied ? <p className="field-note">Token copied.</p> : null}
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="wizard-actions robot-setup-actions">
            <Button variant="ghost" onClick={generateToken}>
              <Dices size={17} />
              Create a different robot
            </Button>
            <Button onClick={continueToIdentity} size="lg">
              <Check size={18} />
              I’ve saved it
            </Button>
          </div>
        </section>
      ) : null}

      {step === "identity" && draftIdentity ? (
        <section className="robot-setup-panel identity-step" aria-labelledby="robot-identity-title">
          <div className="robot-setup-copy robot-identity-copy">
            <h3 id="robot-identity-title">Meet your robot</h3>
            <p>This name and avatar help you recognize your robot.</p>
          </div>
          <RobotAvatar hashId={draftIdentity.hashId} label={draftNickname} size="xl" />
          <div className="robot-name-reveal">
            <span>Hi! My name is</span>
            <strong>
              <Zap size={22} fill="currentColor" />
              {robotNameIsResolving ? "Meeting robot..." : draftNickname}
              <Zap size={22} fill="currentColor" />
            </strong>
          </div>
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <Button onClick={() => void finishRobotSetup()} loading={saving} size="lg">
            <Check size={18} />
            Enter my Garage
          </Button>
        </section>
      ) : null}
    </div>
  );
}

function fallbackRobotName(hashId: string): string {
  return `Robot ${hashId.slice(0, 8)}`;
}

async function resolveRobotName(hashId: string, fallback: string): Promise<string> {
  try {
    const { generateRoboname } = await import("@/domains/identity/robonameClient");
    return generateRoboname(hashId);
  } catch {
    return fallback;
  }
}

function prewarmRobotAvatar(hashId: string): void {
  void import("@/domains/identity/roboavatarClient")
    .then(({ prewarmRobotAvatar }) => prewarmRobotAvatar(hashId))
    .catch(() => undefined);
}

function finalizeRobotSlot(
  token: string,
  hashId: string,
  currentNickname: string,
  updateSlotIdentityDetails: (
    token: string,
    details: { nickname?: string; keys?: { pubKey: string; encPrivKey: string } }
  ) => void
): void {
  void resolveRobotName(hashId, currentNickname).then((nickname) => {
    if (nickname !== currentNickname) {
      updateSlotIdentityDetails(token, { nickname });
    }
  });

  scheduleBackgroundIdentityWork(() => {
    const slot = useGarageStore.getState().slots.find((candidate) => candidate.token === token);
    if (!slot || Object.values(slot.robots).some((robot) => robot.pubKey && robot.encPrivKey)) return;
    void import("@/domains/crypto/pgp")
      .then(({ generatePgpKeyPair }) => generatePgpKeyPair(token))
      .then((keyPair) => {
        updateSlotIdentityDetails(token, {
          keys: {
            pubKey: keyPair.publicKeyArmored,
            encPrivKey: keyPair.encryptedPrivateKeyArmored
          }
        });
      })
      .catch(() => undefined);
  });
}

function scheduleBackgroundIdentityWork(callback: () => void): void {
  if (typeof window === "undefined") {
    queueMicrotask(callback);
    return;
  }

  window.setTimeout(() => {
    const idleWindow = window as unknown as {
      requestIdleCallback?: (idleCallback: () => void, options?: { timeout: number }) => number;
    };
    if (idleWindow.requestIdleCallback) {
      idleWindow.requestIdleCallback(callback, { timeout: 4000 });
      return;
    }
    callback();
  }, 800);
}

function TokenInput({
  token,
  setToken,
  readOnly = false
}: {
  token: string;
  setToken: (token: string) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="input-shell token-input-shell robot-token-field">
      <KeyRound size={16} />
      <input
        value={token}
        onChange={(event) => setToken(event.target.value.replace(/\s+/g, ""))}
        placeholder="Paste robot token"
        aria-label="Robot token"
        autoCapitalize="none"
        autoComplete="off"
        readOnly={readOnly}
        spellCheck={false}
      />
    </div>
  );
}
