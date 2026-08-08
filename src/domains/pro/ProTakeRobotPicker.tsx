import { useEffect, useMemo, useRef } from "react";
import { AppTransitionDialog } from "@/domains/navigation/AppTransitionFeedback";
import { useGarageStore, type RobotSlot } from "@/domains/garage/garageStore";
import { CreateOfferRobotPicker } from "@/domains/pro/ProWorkspaceDialogs";
import { selectOfferReadyRobots, type OfferReadyRobots } from "@/domains/pro/proRobotLifecycle";
import { summarizeProRobots } from "@/domains/pro/proSelectors";
import { useProTradeIndexStore } from "@/domains/pro/proTradeIndexStore";
import { selectProGarageSlots, useGarageVaultStore } from "@/domains/pro/garageVaultStore";

export function ProTakeRobotPicker({
  onClose,
  onSelect
}: {
  onClose: () => void;
  onSelect: (slot: RobotSlot) => void;
}) {
  const allSlots = useGarageStore((state) => state.slots);
  const hydrateGarage = useGarageStore((state) => state.hydrate);
  const manifest = useGarageVaultStore((state) => state.manifest);
  const vaultStatus = useGarageVaultStore((state) => state.status);
  const initializeVault = useGarageVaultStore((state) => state.initialize);
  const snapshots = useProTradeIndexStore((state) => state.snapshots);
  const autoSelected = useRef(false);
  const slots = useMemo(() => selectProGarageSlots(allSlots, manifest), [allSlots, manifest]);
  const readyRobots = useMemo(
    () => selectOfferReadyRobots(slots, summarizeProRobots(slots, snapshots), snapshots),
    [slots, snapshots]
  );

  useEffect(() => {
    hydrateGarage();
    void initializeVault();
  }, [hydrateGarage, initializeVault]);

  useEffect(() => {
    if (vaultStatus === "idle" || vaultStatus === "loading" || autoSelected.current) return;
    if (!shouldAutoSelectReadyRobot(readyRobots)) return;
    const slot = slots.find((item) => item.tokenSHA256 === readyRobots[0].slotId);
    if (!slot) return;
    autoSelected.current = true;
    onSelect(slot);
  }, [onSelect, readyRobots, slots, vaultStatus]);

  if (vaultStatus === "idle" || vaultStatus === "loading" || shouldAutoSelectReadyRobot(readyRobots)) {
    return (
      <AppTransitionDialog title="Preparing your Robot Fleet" message="Finding an available robot for this offer." />
    );
  }

  return (
    <CreateOfferRobotPicker
      emptyMessage="Every Fleet robot already has an order or still needs to be refreshed."
      onClose={onClose}
      onSelect={(slotId) => {
        const slot = slots.find((item) => item.tokenSHA256 === slotId);
        if (slot) onSelect(slot);
      }}
      optionStatus="Ready to take this offer"
      robots={readyRobots}
      subtitle="Available Fleet robots without another order"
      title="Take with which robot?"
    />
  );
}

export function shouldAutoSelectReadyRobot(robots: OfferReadyRobots): boolean {
  return robots.length === 1 && !robots[0].previouslyUsed;
}
