import type { ReactNode } from "react";
import { useState } from "react";
import { Check, Copy, Dices, Info, KeyRound, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { RobotAvatar } from "@/domains/identity/RobotAvatar";
import { deriveRobotIdentity, type RobotIdentity } from "@/domains/identity/robotIdentity";
import {
  generateRoboname,
  prepareRobotIdentity,
  prewarmRobotIdentity
} from "@/domains/identity/roboidentitiesClient";
import { useGarageStore } from "@/domains/garage/garageStore";
import { generateRobotToken } from "@/domains/garage/token";
import { cn } from "@/lib/cn";

type WizardStep = "token" | "identity" | "ready";

export function CreateRobotPanel({ onProfile }: { onProfile?: () => void }) {
  const navigate = useNavigate();
  const addSlot = useGarageStore((state) => state.addSlot);
  const updateSlotIdentityDetails = useGarageStore((state) => state.updateSlotIdentityDetails);
  const [step, setStep] = useState<WizardStep>("token");
  const [token, setToken] = useState("");
  const [draftIdentity, setDraftIdentity] = useState<RobotIdentity | null>(null);
  const [draftNickname, setDraftNickname] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [preparingIdentity, setPreparingIdentity] = useState(false);
  const [saving, setSaving] = useState(false);

  const hasToken = token.trim().length > 0;

  const updateToken = (nextToken: string) => {
    setToken(nextToken);
    setDraftIdentity(null);
    setDraftNickname("");
    setCopied(false);
    setError("");
  };

  const generateToken = () => {
    setRolling(true);
    const nextToken = generateRobotToken();
    prewarmRobotIdentity(deriveRobotIdentity(nextToken).hashId);
    window.setTimeout(() => setRolling(false), 420);
    setToken(nextToken);
    setDraftIdentity(null);
    setDraftNickname("");
    setCopied(false);
    setError("");
  };

  const continueToIdentity = async () => {
    const cleanToken = token.trim();
    if (!cleanToken) {
      setError("Enter a robot token first.");
      return;
    }

    const identity = deriveRobotIdentity(cleanToken);
    setPreparingIdentity(true);
    setError("");
    try {
      const prepared = await prepareRobotIdentity(identity.hashId);
      setDraftIdentity(identity);
      setDraftNickname(prepared.nickname);
      setStep("identity");
    } catch {
      setError("Could not prepare your robot identity. Check your connection and try again.");
    } finally {
      setPreparingIdentity(false);
    }
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
      setStep("ready");
      return true;
    } catch {
      setError("Could not create local encryption keys. Try again.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const finishRobotSetup = async () => {
    const saved = await saveRobot();
    if (!saved) return;
    void import("@/app/prewarm")
      .then(({ prewarmActiveRobotTradeData }) => prewarmActiveRobotTradeData())
      .catch(() => undefined);
    onProfile?.();
    navigate("/garage");
  };

  const copyToken = async () => {
    if (!token) return;
    await navigator.clipboard?.writeText(token);
    setCopied(true);
  };

  return (
    <div className="robot-wizard" aria-label="Robot setup wizard">
      <WizardSection title="1. Generate a token" active={step === "token"} complete={step !== "token"}>
        {!hasToken ? (
          <div className="wizard-step-body token-start-step">
            <p>This temporary key gives you access to a unique private robot identity for your trade.</p>
            <Button onClick={generateToken} size="lg">
              <Dices className={cn(rolling && "dice-roll")} size={18} />
              Generate token
            </Button>
            <details className="recover-token-details">
              <summary>Recover with existing token</summary>
              <TokenInput token={token} setToken={updateToken} copied={copied} copyToken={copyToken} />
              <Button onClick={() => void continueToIdentity()} disabled={!hasToken} loading={preparingIdentity}>
                <Check size={17} />
                Continue
              </Button>
            </details>
          </div>
        ) : (
          <div className="wizard-step-body token-review-step">
            <div className="token-alert">
              <Info size={18} />
              <p>
                <strong>Store it somewhere safe.</strong> This token is the only key to your robot.
              </p>
            </div>
            <TokenInput token={token} setToken={updateToken} copied={copied} copyToken={copyToken} />
            {copied ? <p className="field-note">Token copied.</p> : null}
            {error ? <p className="field-error">{error}</p> : null}
            <div className="wizard-actions centered-actions">
              <Button variant="ghost" onClick={generateToken}>
                <Dices className={cn(rolling && "dice-roll")} size={17} />
                Roll again
              </Button>
              <Button onClick={() => void continueToIdentity()} loading={preparingIdentity} size="lg">
                <Check size={18} />
                Continue
              </Button>
            </div>
          </div>
        )}
      </WizardSection>

      <WizardSection title="2. Meet your robot identity" active={step === "identity"} complete={step === "ready"}>
        {draftIdentity ? (
          <div className="wizard-step-body identity-step">
            <p>This is your trading avatar.</p>
            <RobotAvatar hashId={draftIdentity.hashId} label={draftNickname} size="xl" />
            <div className="robot-name-reveal">
              <span>Hi! My name is</span>
              <strong>
                <Zap size={22} fill="currentColor" />
                {draftNickname}
                <Zap size={22} fill="currentColor" />
              </strong>
            </div>
            {error ? <p className="field-error">{error}</p> : null}
            <Button onClick={() => void finishRobotSetup()} loading={saving} size="lg">
              <Check size={18} />
              Continue
            </Button>
          </div>
        ) : null}
      </WizardSection>
    </div>
  );
}

function fallbackRobotName(hashId: string): string {
  return `Robot ${hashId.slice(0, 8)}`;
}

async function resolveRobotName(hashId: string, fallback: string): Promise<string> {
  try {
    return generateRoboname(hashId);
  } catch {
    return fallback;
  }
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

function WizardSection({
  title,
  active,
  complete,
  children
}: {
  title: string;
  active: boolean;
  complete: boolean;
  children: ReactNode;
}) {
  return (
    <section className={cn("wizard-section", active && "active", complete && "complete")}>
      <h3>
        {complete ? <Check size={18} /> : null}
        {title}
      </h3>
      {active ? children : null}
    </section>
  );
}

function TokenInput({
  token,
  setToken,
  copied,
  copyToken
}: {
  token: string;
  setToken: (token: string) => void;
  copied: boolean;
  copyToken: () => Promise<void>;
}) {
  return (
    <div className="input-shell token-input-shell">
      <KeyRound size={16} />
      <input
        value={token}
        onChange={(event) => setToken(event.target.value.replace(/\s+/g, ""))}
        placeholder="Paste robot token"
        aria-label="Robot token"
      />
      <button className="icon-button" type="button" onClick={() => void copyToken()} disabled={!token} title={copied ? "Copied" : "Copy"}>
        <Copy size={16} />
        <span className="sr-only">Copy token</span>
      </button>
    </div>
  );
}
