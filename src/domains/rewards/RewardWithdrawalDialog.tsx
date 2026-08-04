import { CircleAlert, CircleCheck, RotateCw, Trophy, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import { type RobotSlot, useGarageStore } from "@/domains/garage/garageStore";
import { didRobotCoordinatorRefreshSucceed } from "@/domains/garage/robotRefreshEvents";
import { RewardWithdrawalPanel } from "@/domains/rewards/RewardWithdrawalPanel";

type ClaimState = {
  shortAlias: string;
  reconciliation: "refreshing" | "ready" | "unavailable";
};

export function RewardWithdrawalDialog({
  coordinators,
  onClose,
  slot
}: {
  coordinators: CoordinatorSummary[];
  onClose: () => void;
  slot: RobotSlot;
}) {
  const refreshRobotSlot = useGarageStore((state) => state.refreshRobotSlot);
  const acknowledgeRewardClaim = useGarageStore((state) => state.acknowledgeRewardClaim);
  const refreshCoordinators = useFederationStore((state) => state.refreshCoordinators);
  const [claimState, setClaimState] = useState<ClaimState>();
  const [retryingAvailability, setRetryingAvailability] = useState(false);
  const rewardAliases = new Set(
    Object.values(slot.robots)
      .filter((robot) => (robot.earnedRewards ?? 0) > 0)
      .map((robot) => robot.shortAlias)
      .filter((shortAlias): shortAlias is string => Boolean(shortAlias))
  );
  const rewardCoordinatorAvailable = coordinators.some(
    (coordinator) => rewardAliases.has(coordinator.shortAlias) && Boolean(coordinator.url)
  );

  function finishClaim(shortAlias: string) {
    acknowledgeRewardClaim(slot.token, shortAlias);
    setClaimState({ shortAlias, reconciliation: "refreshing" });
    void reconcileReward(shortAlias, "background");
  }

  async function reconcileReward(shortAlias: string, priority: "background" | "visible") {
    const coordinator = coordinators.find((item) => item.shortAlias === shortAlias);
    if (!coordinator?.url) {
      setClaimState({ shortAlias, reconciliation: "unavailable" });
      return;
    }
    try {
      const result = await refreshRobotSlot(slot.token, [coordinator], {
        maxAgeMs: 0,
        preferredAliases: [shortAlias],
        priority,
        source: "robot-refresh",
        supersedeInFlight: true
      });
      setClaimState({
        shortAlias,
        reconciliation: didRobotCoordinatorRefreshSucceed(result, shortAlias) ? "ready" : "unavailable"
      });
    } catch {
      setClaimState({ shortAlias, reconciliation: "unavailable" });
    }
  }

  async function retryCoordinatorAvailability() {
    setRetryingAvailability(true);
    try {
      await refreshCoordinators();
    } catch {
      // The existing unavailable state remains actionable for another retry.
    } finally {
      setRetryingAvailability(false);
    }
  }

  return (
    <Dialog
      ariaLabelledby="reward-withdrawal-title"
      onClose={onClose}
      overlayClassName="garage-reward-dialog-overlay"
      panelClassName="garage-reward-dialog"
    >
      <button className="take-modal-close" onClick={onClose} type="button" aria-label="Close reward withdrawal">
        <X size={20} />
      </button>
      <header>
        <Trophy size={21} />
        <div>
          <span className="app-eyebrow">Robot rewards</span>
          <h2 id="reward-withdrawal-title">Claim sats</h2>
        </div>
      </header>
      {claimState ? (
        <RewardClaimResult
          onClose={onClose}
          onRetry={() => {
            setClaimState({ ...claimState, reconciliation: "refreshing" });
            void reconcileReward(claimState.shortAlias, "visible");
          }}
          reconciliation={claimState.reconciliation}
        />
      ) : rewardCoordinatorAvailable ? (
        <RewardWithdrawalPanel coordinators={coordinators} onClaimed={finishClaim} slot={slot} />
      ) : (
        <section className="reward-claim-result" role="status" aria-live="polite">
          <span className="reward-claim-result-icon reward-claim-result-icon-warning" aria-hidden="true">
            <CircleAlert size={22} />
          </span>
          <strong>Reward details unavailable</strong>
          <p>Refresh the coordinator list, then try again.</p>
          <div className="reward-claim-result-actions">
            <Button
              loading={retryingAvailability}
              loadingLabel="Refreshing coordinators"
              onClick={() => void retryCoordinatorAvailability()}
              type="button"
              variant="outline"
            >
              {!retryingAvailability ? <RotateCw size={16} /> : null}
              Retry
            </Button>
            <Button onClick={onClose} type="button" variant="secondary">
              Close
            </Button>
          </div>
        </section>
      )}
    </Dialog>
  );
}

function RewardClaimResult({
  onClose,
  onRetry,
  reconciliation
}: {
  onClose: () => void;
  onRetry: () => void;
  reconciliation: ClaimState["reconciliation"];
}) {
  return (
    <section className="reward-claim-result" role="status" aria-live="polite">
      <span className="reward-claim-result-icon" aria-hidden="true">
        <CircleCheck size={24} />
      </span>
      <strong>Withdrawal requested</strong>
      <p>The coordinator accepted your Lightning invoice.</p>
      <div className={`reward-claim-reconciliation reward-claim-reconciliation-${reconciliation}`}>
        {reconciliation === "refreshing" ? <span className="ui-spinner" aria-hidden="true" /> : null}
        {reconciliation === "ready" ? <CircleCheck size={16} aria-hidden="true" /> : null}
        {reconciliation === "unavailable" ? <CircleAlert size={16} aria-hidden="true" /> : null}
        <span>
          {reconciliation === "refreshing"
            ? "Updating this robot's balance in the background."
            : reconciliation === "ready"
              ? "Robot balance updated."
              : "The latest balance could not be checked yet."}
        </span>
      </div>
      <div className="reward-claim-result-actions">
        {reconciliation === "unavailable" ? (
          <Button onClick={onRetry} type="button" variant="outline">
            <RotateCw size={16} /> Retry balance
          </Button>
        ) : null}
        <Button onClick={onClose} type="button" variant="secondary">
          Done
        </Button>
      </div>
    </section>
  );
}
