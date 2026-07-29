import { Check, Copy, Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { downloadRobotTokenBackup } from "@/domains/garage/tokenBackup";
import { writeClipboard } from "@/lib/clipboard";

export function RobotTokenBackupDialog({
  onClose,
  robotName,
  token
}: {
  onClose: () => void;
  robotName: string;
  token: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copyToken() {
    try {
      await writeClipboard(token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Dialog
      ariaLabelledby="token-backup-title"
      onClose={onClose}
      overlayClassName="confirm-overlay token-backup-overlay"
      panelClassName="confirm-sheet token-backup-sheet"
    >
        <div>
          <h3 id="token-backup-title">Store your robot token</h3>
          <p className="muted-copy">This token is the only way to recover this robot on another device.</p>
        </div>
        <div className="token-backup-value">
          <div>
            <small>Back it up</small>
            <code>{token}</code>
          </div>
          <div className="token-backup-actions">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => downloadRobotTokenBackup(token, robotName)}
              aria-label={`Download ${robotName} token backup as JSON`}
              title="Download JSON backup"
            >
              <Download size={18} />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => void copyToken()} aria-label="Copy robot token">
              {copied ? <Check size={18} /> : <Copy size={18} />}
            </Button>
          </div>
        </div>
        <div className="confirm-actions">
          <Button onClick={onClose}>Done</Button>
        </div>
    </Dialog>
  );
}
