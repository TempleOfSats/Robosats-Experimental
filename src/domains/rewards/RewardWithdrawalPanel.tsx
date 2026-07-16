import { useEffect, useMemo, useState } from "react";
import { WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toUserMessage } from "@/lib/userError";
import { Card, CardContent } from "@/components/ui/card";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { signCleartextMessage } from "@/domains/crypto/pgp";
import { getRobotAuthForCoordinator, type RobotSlot } from "@/domains/garage/garageStore";
import { claimReward } from "@/domains/rewards/rewardApi";
import { formatSats } from "@/lib/format";

export function RewardWithdrawalPanel({
  coordinators,
  onClaimed,
  slot
}: {
  coordinators: CoordinatorSummary[];
  onClaimed: () => Promise<void>;
  slot: RobotSlot;
}) {
  const coordinatorAliases = useMemo(() => new Set(coordinators.map((coordinator) => coordinator.shortAlias)), [coordinators]);
  const rewardRobots = useMemo(
    () => Object.values(slot.robots).filter(
      (robot) => (robot.earnedRewards ?? 0) > 0 && robot.shortAlias && coordinatorAliases.has(robot.shortAlias)
    ),
    [coordinatorAliases, slot.robots]
  );
  const [selectedAlias, setSelectedAlias] = useState(rewardRobots[0]?.shortAlias ?? "");
  const [invoice, setInvoice] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const rewardRobot = rewardRobots.find((robot) => robot.shortAlias === selectedAlias) ?? rewardRobots[0];
  const coordinator = coordinators.find((item) => item.shortAlias === rewardRobot?.shortAlias);
  const rewardSats = rewardRobot?.earnedRewards ?? 0;
  const invoiceReady = normalizeLightningInvoice(invoice).length > 0;

  useEffect(() => {
    if (!rewardRobots.some((robot) => robot.shortAlias === selectedAlias)) {
      setSelectedAlias(rewardRobots[0]?.shortAlias ?? "");
    }
  }, [rewardRobots, selectedAlias]);

  if (rewardRobots.length === 0) return null;

  async function submitRewardWithdrawal() {
    setError("");
    setSuccess("");
    if (!rewardRobot?.shortAlias || !coordinator) {
      setError("Reward coordinator is not available.");
      return;
    }
    if (!rewardRobot.encPrivKey) {
      setError("This robot is missing local encryption keys. Refresh it from Garage first.");
      return;
    }
    const auth = getRobotAuthForCoordinator(slot, rewardRobot.shortAlias);
    if (!auth) {
      setError("This robot is missing coordinator credentials.");
      return;
    }
    const rawInvoice = normalizeLightningInvoice(invoice);
    if (!rawInvoice) {
      setError("Paste a Lightning invoice for the reward amount first.");
      return;
    }

    setSubmitting(true);
    try {
      const signedInvoice = await signCleartextMessage(rawInvoice, rewardRobot.encPrivKey, slot.token);
      const result = await claimReward(coordinator.url, signedInvoice, 0, auth);
      if (result.successfulWithdrawal) {
        setInvoice("");
        setSuccess("Reward withdrawal requested.");
        await onClaimed();
      } else {
        setError(toUserMessage(result.error, "Reward withdrawal was rejected."));
      }
    } catch (claimError) {
      setError(toUserMessage(claimError, "Could not withdraw reward."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="reward-withdrawal-card">
      <CardContent>
        <form
          className="payout-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitRewardWithdrawal();
          }}
        >
          <div className="payment-primary reward-target">
            <span className="muted-copy">Invoice amount</span>
            <strong className="payment-amount tabular">{formatSats(rewardSats)}</strong>
          </div>
          <p className="reward-withdrawal-copy">
            Paste a Lightning invoice for this exact amount.
          </p>
          {rewardRobots.length > 1 ? (
            <label className="field-block">
              Coordinator
              <select value={selectedAlias} onChange={(event) => setSelectedAlias(event.target.value)}>
                {rewardRobots.map((robot) => (
                  <option key={robot.shortAlias} value={robot.shortAlias}>
                    {robot.shortAlias} - {robot.earnedRewards ?? 0} sats
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="muted-copy">Coordinator: {rewardRobot?.shortAlias}</p>
          )}

          <label className="field-block">
            Lightning invoice
            <textarea
              onChange={(event) => setInvoice(event.target.value)}
              placeholder="lnbc..."
              rows={4}
              value={invoice}
            />
          </label>

          {error ? <p className="field-error">{error}</p> : null}
          {success ? <p className="field-note">{success}</p> : null}

          <Button className="full-width" disabled={!invoiceReady || submitting} loading={submitting} type="submit">
            <WalletCards size={16} />
            Withdraw your sats!
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function normalizeLightningInvoice(value: string): string {
  const invoice = value.trim();
  return invoice.toLowerCase().startsWith("lightning:") ? invoice.slice("lightning:".length) : invoice;
}
