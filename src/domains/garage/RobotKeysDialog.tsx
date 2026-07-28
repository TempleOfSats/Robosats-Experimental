import { Check, Copy, Download, KeyRound, X } from "lucide-react";
import { nip19 } from "nostr-tools";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Tabs, tabId } from "@/components/ui/tabs";
import type { RobotSlot } from "@/domains/garage/garageStore";
import { deriveRobotIdentity } from "@/domains/identity/robotIdentity";
import { writeClipboard } from "@/lib/clipboard";

type KeyTab = "nostr" | "pgp";

export function RobotKeysDialog({ onClose, slot }: { onClose: () => void; slot: RobotSlot }) {
  const [tab, setTab] = useState<KeyTab>("nostr");
  const [copied, setCopied] = useState("");
  const credentials = useMemo(() => robotCredentials(slot), [slot]);

  async function copy(label: string, value: string) {
    if (!value) return;
    try {
      await writeClipboard(value);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1200);
    } catch {
      setCopied("");
    }
  }

  return (
    <Dialog
      ariaLabelledby="robot-keys-title"
      onClose={onClose}
      overlayClassName="robot-keys-overlay"
      panelClassName="robot-keys-dialog"
    >
        <button className="take-modal-close" onClick={onClose} type="button" aria-label="Close robot keys">
          <X size={20} />
        </button>

        <header>
          <KeyRound size={22} />
          <h2 id="robot-keys-title">Don't trust, verify</h2>
        </header>

        <Tabs
          ariaLabel="Robot key type"
          className="robot-key-tabs"
          id="robot-keys"
          onChange={setTab}
          options={[
            { value: "nostr", label: "Nostr" },
            { value: "pgp", label: "OpenPGP" }
          ]}
          panelId="robot-key-panel"
          value={tab}
        />

        <section
          aria-labelledby={tabId("robot-keys", tab)}
          className="robot-key-panel"
          id="robot-key-panel"
          role="tabpanel"
        >
          {tab === "nostr" ? (
            <>
              <p>Your messages use secp256k1 Schnorr signatures and end-to-end encryption. These credentials let you independently verify that identity.</p>
              <CredentialField label="Your public key" value={credentials.nostrPublicKey} copied={copied} onCopy={copy} />
              <CredentialField label="Your private key" value={credentials.nostrPrivateKey} copied={copied} onCopy={copy} sensitive />
              <Button type="button" size="sm" onClick={() => downloadCredentials("nostr_keys.json", credentials.nostrExport)}>
                <Download size={16} />
                Export keys
              </Button>
            </>
          ) : (
            <>
              <p>Your coordinator chat uses OpenPGP end-to-end encryption. The private key remains encrypted with your robot token.</p>
              <CredentialField label="Your public key" value={credentials.pgpPublicKey} copied={copied} onCopy={copy} multiline />
              <CredentialField label="Your encrypted private key" value={credentials.pgpEncryptedPrivateKey} copied={copied} onCopy={copy} multiline sensitive />
              <CredentialField label="Your private key passphrase (keep secure!)" value={credentials.passphrase} copied={copied} onCopy={copy} sensitive />
              <Button type="button" size="sm" onClick={() => downloadCredentials("pgp_keys.json", credentials.pgpExport)}>
                <Download size={16} />
                Export keys
              </Button>
            </>
          )}
        </section>

        <Button className="robot-keys-back" type="button" variant="ghost" onClick={onClose}>
          Back
        </Button>
    </Dialog>
  );
}

function CredentialField({
  copied,
  label,
  multiline = false,
  onCopy,
  sensitive = false,
  value
}: {
  copied: string;
  label: string;
  multiline?: boolean;
  onCopy: (label: string, value: string) => Promise<void>;
  sensitive?: boolean;
  value: string;
}) {
  return (
    <label className="robot-key-field">
      <span>{label}</span>
      <span className="robot-key-value">
        {multiline ? (
          <textarea readOnly rows={4} value={value} aria-label={label} />
        ) : (
          <input readOnly value={value} aria-label={label} data-sensitive={sensitive || undefined} />
        )}
        <button type="button" onClick={() => void onCopy(label, value)} aria-label={`Copy ${label}`} disabled={!value}>
          {copied === label ? <Check size={17} /> : <Copy size={17} />}
        </button>
      </span>
    </label>
  );
}

export function robotCredentials(slot: RobotSlot) {
  const identity = deriveRobotIdentity(slot.token);
  const keyedRobot = Object.values(slot.robots).find((robot) => robot.pubKey && robot.encPrivKey);
  const nostrPublicKey = nip19.npubEncode(identity.nostrPubKey);
  const nostrPrivateKey = nip19.nsecEncode(identity.nostrSecKey);
  const pgpPublicKey = keyedRobot?.pubKey ?? "";
  const pgpEncryptedPrivateKey = keyedRobot?.encPrivKey ?? "";

  return {
    nostrPublicKey,
    nostrPrivateKey,
    pgpPublicKey,
    pgpEncryptedPrivateKey,
    passphrase: slot.token,
    nostrExport: { own_public_key: nostrPublicKey, private_key: nostrPrivateKey },
    pgpExport: {
      own_public_key: pgpPublicKey,
      encrypted_private_key: pgpEncryptedPrivateKey,
      passphrase: slot.token
    }
  };
}

function downloadCredentials(filename: string, credentials: object) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(credentials, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
