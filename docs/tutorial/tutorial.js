const screenshotRoot = "../assets/tutorial/screenshots";
const avatarRoot = "../assets/tutorial/avatars";

const renderMode = new URLSearchParams(window.location.search).has("render");

if (renderMode) {
  document.documentElement.classList.add("rendering");
}

const slides = [
  {
    kind: "cover",
    section: "ROBOGUIDE 01",
    title: "Beep, Bop, Trade.",
    action: "A visual flight manual for today’s RoboSats — from first robot to a full Pro Trade Desk.",
    why: "Real current screens. Exact in-app robot avatars. Sensitive values intentionally hidden.",
    visuals: ["garage-home", "pro-trades"]
  },
  {
    section: "PRE-FLIGHT",
    title: "Pack the right tools",
    action: "Open RoboSats through supported Tor access and have a working Lightning wallet ready.",
    why: "Bonds, escrow, and payouts are timed. Test the wallet before a live trade starts.",
    tips: ["Tor connection", "Lightning wallet", "Enough uninterrupted time"],
    visual: "garage-empty",
    target: [0.16, 0.36],
    quip: "Wallet ready. Panic unnecessary."
  },
  {
    section: "NAVIGATION",
    title: "Know your way around",
    action: "Use the desktop sidebar or mobile bottom bar to move between the main areas.",
    why: "The Trade destination appears when an order belongs to the current robot.",
    tips: ["Garage", "Offers", "Create", "Trade", "Settings"],
    visuals: [
      { file: "garage-home", label: "Desktop" },
      { file: "navigation-mobile", label: "Mobile", contain: true }
    ],
    target: [0.14, 0.48, 0],
    quip: "Five doors. One map."
  },
  {
    section: "GARAGE SETUP · 1 OF 3",
    title: "Create your first robot",
    action: "Create a new robot, or restore an identity you already own.",
    why: "Your robot is pseudonymous; its token is the secret that controls it.",
    tips: ["Create robot", "Restore existing", "No account registration"],
    visual: "garage-empty",
    target: [0.58, 0.43],
    quip: "Identity activation starts here."
  },
  {
    section: "GARAGE SETUP · 2 OF 3",
    title: "Back up before moving",
    action: "Copy or download the token, store it privately, then confirm that you saved it.",
    why: "Anyone with the token controls the robot. Losing it can make recovery impossible.",
    tips: ["Copy", "Download", "Store offline", "Never screenshot"],
    visual: "garage-backup",
    target: [0.64, 0.45],
    quip: "Tiny token. Large consequences."
  },
  {
    section: "GARAGE SETUP · 3 OF 3",
    title: "Meet your generated identity",
    action: "Confirm the avatar and generated name, then enter the Garage.",
    why: "This avatar is rendered by the same deterministic generator used throughout the app.",
    tips: ["Generated name", "Generated avatar", "Private local identity"],
    visual: "garage-identity",
    target: [0.58, 0.42],
    quip: "Beep! Identity online."
  },
  {
    section: "GARAGE",
    title: "Make Garage your home",
    action: "Start with Find an offer or Create an offer; open the robot header to switch identities.",
    why: "Trade state and next actions stay prominent while security and management remain in robot settings.",
    tips: ["Find an offer", "Create an offer", "Switch robot", "Robot settings"],
    visual: "garage-home",
    target: [0.56, 0.67],
    quip: "Garage organized. Bolts accounted for."
  },
  {
    section: "GUIDED TRADE · 1 OF 5",
    title: "Choose the trade direction",
    action: "Buy means pay fiat and receive BTC. Sell means lock BTC and receive fiat.",
    why: "Every later amount and payment instruction follows this choice.",
    tips: ["Buy: fiat → BTC", "Sell: BTC → fiat"],
    visual: "guided-side",
    target: [0.53, 0.48],
    quip: "Arrows first, buttons second."
  },
  {
    section: "GUIDED TRADE · 2 OF 5",
    title: "Pick the fiat currency",
    action: "Select the currency you will actually send or receive.",
    why: "Currency determines which offers and payment methods can match.",
    tips: ["Correct unit", "Available now", "Local payment rail"],
    visual: "guided-currency",
    target: [0.56, 0.48],
    quip: "No interplanetary exchange rates."
  },
  {
    section: "GUIDED TRADE · 3 OF 5",
    title: "Set the exact amount",
    action: "Enter the fiat amount you can complete within the trade window.",
    why: "A realistic amount reduces failed payments and cancellation risk.",
    tips: ["Exact fiat amount", "Available balance", "Trade window"],
    visual: "guided-amount",
    target: [0.55, 0.49],
    quip: "Measure twice, trade once."
  },
  {
    section: "GUIDED TRADE · 4 OF 5",
    title: "Choose a payment method",
    action: "Pick one you can use immediately from an account you control.",
    why: "Necessary payment details belong in encrypted trade chat later.",
    tips: ["Available now", "Account access", "Prompt settlement"],
    visual: "guided-method",
    target: [0.56, 0.48],
    quip: "Compatible rails detected."
  },
  {
    section: "GUIDED TRADE · 5 OF 5",
    title: "Compare the best matches",
    action: "Review a matching offer, or create one when none fits.",
    why: "Best match reflects the filters — it is not a safety guarantee.",
    tips: ["Amount", "Premium", "Method", "Expiry"],
    visual: "guided-results",
    target: [0.56, 0.48],
    quip: "Best match still deserves a look."
  },
  {
    section: "ORDERBOOK",
    title: "Read the public offers",
    action: "Filter by side, currency, and method; sort by amount, premium, or expiry.",
    why: "Narrowing the book makes real term comparisons much easier.",
    tips: ["Buy / Sell", "Currency", "Payment Method", "Amount / Premium / Expiry"],
    visual: "orderbook",
    target: [0.52, 0.29],
    quip: "Signal found. Noise reduced."
  },
  {
    section: "TAKE AN OFFER",
    title: "Inspect before you take",
    action: "Verify what you send and receive, then review premium, bond, method, expiry, and coordinator.",
    why: "A robot avatar is not a trust signal. The visible contract terms are what matter.",
    tips: ["You send / receive", "Premium + bond", "Expiry", "Coordinator"],
    visual: "offer-review",
    target: [0.69, 0.63],
    quip: "Trust the checklist, not the avatar."
  },
  {
    section: "CREATE · 1 OF 4",
    title: "Start an offer instead",
    action: "Choose Buy BTC or Sell BTC, then deliberately select the coordinator hosting it.",
    why: "Makers may wait and post a bond, so publish only terms you can complete.",
    tips: ["Buy BTC", "Sell BTC", "Coordinator", "Bitcoin Swap is advanced"],
    visual: "create-side",
    target: [0.48, 0.3],
    quip: "Your terms have entered the chat."
  },
  {
    section: "CREATE · 2 OF 4",
    title: "Build the core terms",
    action: "Set currency, fixed or ranged amount, methods, and premium.",
    why: "These terms become public. Be precise without adding identifying information.",
    tips: ["Fixed / range", "Payment methods", "Premium", "Approximate F2F area"],
    visual: "create-amount",
    target: [0.55, 0.41],
    quip: "Precise beats mysterious."
  },
  {
    section: "CREATE · 3 OF 4",
    title: "Tune advanced terms carefully",
    action: "Keep the defaults unless you understand each timer, privacy control, and bond setting.",
    why: "Descriptions are public; exact F2F time and place belong only in encrypted chat.",
    tips: ["Public duration", "Escrow timer", "Private password", "Fidelity bond"],
    visual: "create-advanced",
    target: [0.57, 0.66],
    quip: "Advanced panel. Caution light on."
  },
  {
    section: "CREATE · 4 OF 4",
    title: "Review, then publish",
    action: "Check the final direction, amount, method, robot, coordinator, premium, and timers.",
    why: "Publishing occupies the robot and starts a timed bond step.",
    tips: ["Offer summary", "Maker robot", "Coordinator", "Create offer"],
    visual: "create-review",
    target: [0.58, 0.47],
    quip: "Final scan complete."
  },
  {
    section: "PUBLISH",
    title: "Lock the maker bond once",
    action: "Verify the exact satoshi amount, then scan or copy the private invoice and pay it once.",
    why: "The bond discourages abandoned orders. Slow UI updates are never a reason to pay twice.",
    tips: ["Exact sats", "Invoice hidden here", "Expiry clock", "Pay once"],
    visual: "trade-maker-bond",
    target: [0.47, 0.5],
    quip: "One invoice. One payment."
  },
  {
    section: "PUBLIC OFFER",
    title: "Manage the waiting offer",
    action: "Leave it public, pause it temporarily, or cancel it permanently.",
    why: "A paused offer still occupies its robot; cancellation closes the order.",
    tips: ["Waiting for a taker", "Pause order", "Cancel order", "Details below"],
    visual: "trade-public",
    target: [0.49, 0.62],
    quip: "Paused is sleeping, not gone."
  },
  {
    section: "WAIT",
    title: "Wait without repeating actions",
    action: "Keep the order open while the peer locks their bond or the coordinator updates.",
    why: "Do not repay, resubmit, or restart merely because Tor or Lightning is slow.",
    tips: ["Taker joined", "Bond pending", "No repeated action"],
    visual: "trade-taker-wait",
    target: [0.49, 0.49],
    quip: "Patience subroutine running."
  },
  {
    section: "BUYER SETUP",
    title: "Choose the buyer payout",
    action: "Provide the exact receiving destination, submit once, and keep that wallet available.",
    why: "An incorrect or expired destination can delay settlement. Use on-chain only intentionally.",
    tips: ["Exact destination", "Submit once", "Wallet online"],
    visual: "trade-setup-buyer",
    target: [0.48, 0.54],
    quip: "Destination locked."
  },
  {
    section: "SELLER SETUP",
    title: "Lock the seller collateral",
    action: "Verify the exact escrow amount and pay the private collateral invoice once.",
    why: "Escrow is separate from the smaller bond. Identify the invoice before paying.",
    tips: ["Seller collateral", "Exact sats", "Different from bond", "Pay once"],
    visual: "trade-setup-seller",
    target: [0.48, 0.5],
    quip: "Correct invoice identified."
  },
  {
    section: "SETUP WAIT",
    title: "Let both sides settle",
    action: "Keep the page reachable while seller collateral or buyer payout setup completes.",
    why: "Wait for the visible state to change before taking another action.",
    tips: ["Escrow wait", "Payout wait", "No duplicate actions"],
    visuals: [
      { file: "trade-escrow-wait", label: "Buyer waits" },
      { file: "trade-payout-wait", label: "Seller waits" }
    ],
    target: [0.5, 0.52, 0],
    quip: "The gears are moving."
  },
  {
    section: "TRADE CHAT",
    title: "Meet in encrypted chat",
    action: "Exchange only the payment details needed to complete this trade.",
    why: "Stay in encrypted chat and minimize personal information. Tutorial message content is redacted.",
    tips: ["Your robot", "Peer robot", "Online status", "Encrypted details"],
    visual: "trade-chat-buyer",
    target: [0.5, 0.42],
    quip: "Encrypted introductions complete."
  },
  {
    section: "BUYER CONFIRMATION",
    title: "Confirm only after sending",
    action: "Press Confirm fiat sent only after the payment has actually left your control.",
    why: "Never confirm early. This tells the seller to inspect their real payment account.",
    tips: ["Pay first", "Verify details", "Confirm once"],
    visual: "trade-chat-buyer",
    target: [0.49, 0.86],
    quip: "The button waits for reality."
  },
  {
    section: "SELLER CONFIRMATION",
    title: "Verify before releasing",
    action: "Inspect the actual receiving account; release only when funds are final and usable.",
    why: "A screenshot, email, notification, or peer message is not payment proof.",
    tips: ["Open real account", "Check finality", "Then release"],
    visual: "trade-chat-seller",
    target: [0.49, 0.86],
    quip: "Evidence first. Bolts later."
  },
  {
    section: "PAYOUT ROUTING",
    title: "Keep the wallet reachable",
    action:
      "Keep the wallet online during an automatic retry; if the invoice expires, submit a fresh receiving invoice.",
    why: "A replacement updates where you receive bitcoin. You never make another payment.",
    tips: ["Automatic: wait", "Expired invoice: replace", "Never pay again"],
    visuals: [
      { file: "trade-routing-auto", label: "Automatic retry", contain: true },
      { file: "trade-routing-retry", label: "Replacement required", contain: true }
    ],
    target: [0.51, 0.52, 0],
    quip: "Retry waits. Expiry replaces."
  },
  {
    section: "FINISH",
    title: "Finish, save, and rate",
    action: "Download the overview if needed, rate the experience, or start another trade.",
    why: "Store downloaded records privately and first verify that settlement is complete.",
    tips: ["Download overview", "Rate", "Start another trade"],
    visual: "trade-success",
    target: [0.49, 0.68],
    quip: "Trade complete. Victory beep."
  },
  {
    section: "RECOVERY",
    title: "Recover without leaking identity",
    action: "Open Robot settings to restore a saved token; use a fresh identity when continuity is unnecessary.",
    why: "Never expose a token, and resolve active orders before removing a local identity.",
    tips: ["Recover", "Fresh robot", "Remove carefully", "Token stays secret"],
    visual: "garage-home",
    target: [0.62, 0.54],
    quip: "Privacy likes a fresh chassis."
  },
  {
    section: "PRO MODE",
    title: "Know when Pro helps",
    action: "Use Pro for repeated trading, concurrent identities, presets, and encrypted Fleet recovery.",
    why: "It organizes the same trading protocol — it is not a different or inherently safer trade type.",
    tips: ["Up to 6 robots", "Concurrent work", "Presets", "Encrypted recovery"],
    visuals: [
      { file: "garage-home", label: "Standard" },
      { file: "pro-trades", label: "Pro" }
    ],
    target: [0.54, 0.34, 1],
    guide: "bop",
    quip: "More dashboards, same physics."
  },
  {
    section: "PRO SETUP · 1 OF 3",
    title: "Turn on Pro Mode",
    action: "Open Settings, enable Pro Mode, and continue to the Fleet workspace.",
    why: "Switching modes is nondestructive and does not erase Standard Garage identities.",
    tips: ["Settings", "Pro Mode", "Reversible view"],
    visual: "pro-settings",
    target: [0.71, 0.22],
    guide: "bop",
    quip: "Additional control panels online."
  },
  {
    section: "PRO SETUP · 2 OF 3",
    title: "Start or restore a Fleet",
    action: "Set up a new Fleet, restore the existing one, or keep Standard Garage.",
    why: "Restore rather than create a second Fleet when you already own its key.",
    tips: ["Set up new Fleet", "Restore Fleet", "Keep standard Garage"],
    visual: "pro-setup",
    target: [0.54, 0.64],
    guide: "bop",
    quip: "Choose the correct hangar."
  },
  {
    section: "PRO SETUP · 3 OF 3",
    title: "Back up the Fleet key",
    action: "Copy or download the key, store it privately, then continue to Trade Desk.",
    why: "It recreates the Fleet and must never appear in screenshots, chat, or support messages.",
    tips: ["Copy", "Download", "Store offline", "Hidden here"],
    visual: "pro-fleet-backup",
    target: [0.57, 0.62],
    guide: "bop",
    quip: "Master key secured."
  },
  {
    section: "TRADE DESK · 1 OF 3",
    title: "Read the Trade Desk header",
    action: "Use Create offer, Refresh, and the Fleet sync indicator from one workspace.",
    why: "Fleet synced describes encrypted backup sync — not proof every live order is current.",
    tips: ["Trade Desk", "Create offer", "Refresh", "Fleet synced / syncing"],
    visual: "pro-trades",
    target: [0.78, 0.18],
    guide: "bop",
    quip: "Dashboard online. Assumptions offline."
  },
  {
    section: "TRADE DESK · 2 OF 3",
    title: "Triage by trade state",
    action: "Start with Needs action, then scan In progress, Public offers, and Renewable.",
    why: "Renewable terms still need review before republishing.",
    tips: ["Needs action", "In progress", "Public offers", "Renewable"],
    visual: "pro-trades",
    target: [0.55, 0.3],
    guide: "bop",
    quip: "Urgency sorted."
  },
  {
    section: "TRADE DESK · 3 OF 3",
    title: "Move between Desk views",
    action: "Switch among Trades, Robot Fleet, and History according to the task.",
    why: "History records outcomes; it is never the authoritative live-status view.",
    tips: ["Trades", "Robot Fleet", "History"],
    visual: "pro-trades",
    target: [0.47, 0.4],
    guide: "bop",
    quip: "Right tab, fewer surprises."
  },
  {
    section: "ROBOT FLEET",
    title: "Manage the robot crew",
    action: "Add robots and read each visible status before assigning work.",
    why: "A Fleet supports six robots; each can own only one coordinator order at a time.",
    tips: ["Ready", "Needs attention", "Ongoing trade", "Renewable trade"],
    visual: "pro-robots",
    target: [0.64, 0.54],
    guide: "bop",
    quip: "Crew status confirmed."
  },
  {
    section: "ROBOT CONTROLS",
    title: "Use the robot menu",
    action: "Create an offer, download a backup, configure Telegram alerts, or remove an idle robot.",
    why: "Busy robots cannot be reused or removed; notification messages are never payment proof.",
    tips: ["Create offer", "Download backup", "Telegram alerts", "Remove"],
    visual: "pro-robot-menu",
    target: [0.88, 0.58],
    guide: "bop",
    quip: "Utilities located. Identity preserved."
  },
  {
    section: "ROBOT PICKER",
    title: "Prefer a fresh identity",
    action: "Choose an available robot; use New identity · Best privacy when practical.",
    why: "Reusing a robot can link activity across otherwise separate trades.",
    tips: ["Fresh robot", "Best privacy", "Used before warning"],
    visual: "pro-robot-picker",
    target: [0.57, 0.4],
    guide: "bop",
    quip: "Fresh paint, smaller trail."
  },
  {
    section: "OFFER PRESETS",
    title: "Reuse terms, not judgment",
    action: "Create, use, edit, duplicate, or remove reusable offer terms.",
    why: "A preset does not publish, reserve a robot, or permanently choose a coordinator.",
    tips: ["New / Use", "Edit", "Duplicate", "Remove"],
    visual: "pro-presets",
    target: [0.56, 0.48],
    guide: "bop",
    quip: "Template loaded. Judgment retained."
  },
  {
    section: "PRO TRADES",
    title: "Act from the Trades table",
    action: "Use Pause, Cancel, or Resume only when offered; otherwise open the complete trade.",
    why: "The coordinator sits beneath Order. Every private step remains the normal trade flow.",
    tips: ["Robot", "Order + coordinator", "Status + deadline", "Safe shortcuts"],
    visual: "pro-trades",
    target: [0.84, 0.62],
    guide: "bop",
    quip: "Shortcut when safe, detail when needed."
  },
  {
    section: "PRIVATE HISTORY",
    title: "Review sanitized outcomes",
    action: "History includes completions, collaborative cancellations, and final dispute outcomes.",
    why: "It omits chat, bank details, peer identity, and dispute evidence.",
    tips: ["Completed", "Cancelled together", "Dispute result", "Sanitized summary"],
    visuals: [
      { file: "pro-history", label: "History" },
      { file: "pro-history-detail", label: "Receipt" }
    ],
    target: [0.52, 0.48, 1],
    guide: "bop",
    quip: "Memory stored. Secrets omitted."
  },
  {
    section: "FLEET RECOVERY",
    title: "Sync and restore safely",
    action: "Restore with the Fleet key, then let coordinators recheck live orders.",
    why: "Fleet sync covers encrypted robots, presets, and history — live order truth comes separately.",
    tips: ["Encrypted sync", "Restore Fleet", "Coordinator recheck"],
    visuals: [
      { file: "pro-setup", label: "Restore" },
      { file: "pro-trades", label: "Recheck live state" }
    ],
    target: [0.52, 0.7, 0],
    guide: "bop",
    quip: "Fleet restored. Reality refreshed."
  },
  {
    section: "PRO EXIT",
    title: "Leave without surprises",
    action: "Switch modes freely; abandon the Fleet only after backing up and resolving active work.",
    why: "Abandon is destructive locally and does not cancel orders already held by coordinators.",
    tips: ["Switching is safe", "Backup first", "Remote orders persist", "Abandon is destructive"],
    visual: "pro-abandon",
    target: [0.6, 0.58],
    guide: "bop",
    quip: "Checklist before the eject lever."
  },
  {
    kind: "sources",
    section: "BEEP-BOP CHECKLIST",
    title: "Clarity first. Privacy always.",
    action: "Back up the right secret, read every state, act once, and verify money in the real wallet or account.",
    why: "This guide follows the current repository UI. The 2022 video inspired its teaching rhythm, not its obsolete screens or rules.",
    tips: [
      "Fresh robots when practical",
      "Never pay twice",
      "Chat is not payment proof",
      "Coordinator state is authoritative"
    ],
    visual: "trade-success",
    target: [0.49, 0.44],
    guide: "bop",
    quip: "Pre-flight complete. Trade thoughtfully.",
    sources: [
      ["RoboSats Quick Start", "https://learn.robosats.org/docs/quick-start/"],
      ["Robots and identity", "https://learn.robosats.org/docs/robots/"],
      ["Fidelity bonds", "https://learn.robosats.org/docs/bonds/"],
      ["Trade pipeline", "https://learn.robosats.org/docs/trade-pipeline/"],
      ["BTC Sessions reference video (2022)", "https://www.youtube.com/watch?v=XW_wzRz_BDI"]
    ]
  }
];

const deck = document.querySelector("#deck");
const progress = document.querySelector("#viewer-progress");
const previous = document.querySelector("#previous-slide");
const next = document.querySelector("#next-slide");

const slideElements = slides.map((slide, index) => {
  const frame = document.createElement("div");
  frame.className = "slide-frame";
  const element = renderSlide(slide, index);
  frame.append(element);
  deck.append(frame);
  return element;
});
const slideFrames = [...document.querySelectorAll(".slide-frame")];
let currentSlideIndex = 0;
const observer = new IntersectionObserver(
  (entries) => {
    const current = entries
      .filter((entry) => entry.isIntersecting)
      .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
    if (!current) return;
    const index = slideElements.indexOf(current.target);
    currentSlideIndex = index;
    progress.textContent = `${String(index + 1).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")} · ${slides[index].section}`;
    previous.disabled = index === 0;
    next.disabled = index === slideElements.length - 1;
    previous.dataset.target = String(Math.max(0, index - 1));
    next.dataset.target = String(Math.min(slideElements.length - 1, index + 1));
  },
  { threshold: [0.25, 0.55, 0.8] }
);
slideElements.forEach((slide) => observer.observe(slide));

previous.addEventListener("click", () => scrollToSlide(previous.dataset.target));
next.addEventListener("click", () => scrollToSlide(next.dataset.target));
window.addEventListener("keydown", handleKeyboardNavigation);
window.addEventListener("resize", layoutSlides);

layoutSlides();
void prepareTutorial();

async function prepareTutorial() {
  await waitForImages();
  await document.fonts.ready;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  layoutSlides();
  window.__tutorialReady = true;
}

function layoutSlides() {
  const mobileLayout = !renderMode && window.innerWidth <= 900;
  const widthScale = (window.innerWidth - 48) / 1600;
  const heightScale = (window.innerHeight - 112) / 900;
  const scale = renderMode || mobileLayout ? 1 : Math.max(0.1, Math.min(1, widthScale, heightScale));
  document.documentElement.style.setProperty("--slide-scale", String(scale));
  slideFrames.forEach((frame) => {
    frame.style.width = mobileLayout ? "100%" : `${1600 * scale}px`;
    frame.style.height = mobileLayout ? "auto" : `${900 * scale}px`;
  });
  requestAnimationFrame(drawPointers);
}

function handleKeyboardNavigation(event) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  const destination =
    event.key === "ArrowRight" || event.key === "PageDown"
      ? currentSlideIndex + 1
      : event.key === "ArrowLeft" || event.key === "PageUp"
        ? currentSlideIndex - 1
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? slideElements.length - 1
            : undefined;
  if (destination === undefined) return;
  event.preventDefault();
  scrollToSlide(Math.max(0, Math.min(slideElements.length - 1, destination)));
}

function renderSlide(slide, index) {
  if (slide.kind === "cover") return renderCover(slide, index);

  const element = document.createElement("section");
  element.className = `slide${slide.kind === "sources" ? " slide-sources" : ""}`;
  element.dataset.guide = slide.guide ?? "beep";
  element.id = `slide-${String(index + 1).padStart(2, "0")}`;
  element.innerHTML = `
    <header class="slide-chrome">
      <span class="slide-section">${escapeHtml(slide.section)}</span>
      <span class="slide-count">${String(index + 1).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")}</span>
    </header>
    <div class="slide-copy">
      <h2>${escapeHtml(slide.title)}</h2>
      <p class="slide-action">${escapeHtml(slide.action)}</p>
      <p class="slide-why">${escapeHtml(slide.why)}</p>
      ${renderTips(slide.tips)}
      ${renderSources(slide.sources)}
    </div>
    ${renderVisual(slide)}
    ${renderCallout(slide)}
    <svg class="pointer-layer" viewBox="0 0 1600 900" aria-hidden="true"><path class="pointer-path" /></svg>
    <span class="slide-source-note">Current app fixture · sensitive values intentionally hidden</span>
  `;

  const markerHost = markerContainer(element, slide);
  const marker = document.createElement("span");
  marker.className = "focus-marker";
  marker.textContent = "1";
  marker.style.left = `${slide.target?.[0] * 100 ?? 50}%`;
  marker.style.top = `${slide.target?.[1] * 100 ?? 50}%`;
  markerHost.append(marker);
  return element;
}

function renderCover(slide, index) {
  const element = document.createElement("section");
  element.className = "slide slide-cover";
  element.id = `slide-${String(index + 1).padStart(2, "0")}`;
  element.innerHTML = `
    <header class="slide-chrome">
      <span class="slide-section">${escapeHtml(slide.section)}</span>
      <span class="slide-count">CURRENT UI · 2026 EDITION</span>
    </header>
    <div class="slide-copy">
      <h1>${escapeHtml(slide.title)}</h1>
      <p class="slide-action">${escapeHtml(slide.action)}</p>
      <p class="slide-why">${escapeHtml(slide.why)}</p>
    </div>
    <div class="slide-visual" aria-label="Current RoboSats Standard and Pro screens">
      <img class="cover-shot" src="${shot(slide.visuals[0])}.png" alt="Current Standard Garage" />
      <img class="cover-shot" src="${shot(slide.visuals[1])}.png" alt="Current Pro Trade Desk" />
    </div>
    <div class="cover-robots">
      <div class="cover-robot"><img src="${avatar("beep")}" alt="" /><span><strong>Beep</strong><small>Standard guide</small></span></div>
      <div class="cover-robot"><img src="${avatar("bop")}" alt="" /><span><strong>Bop</strong><small>Pro guide</small></span></div>
    </div>
  `;
  return element;
}

function renderVisual(slide) {
  if (slide.visuals) {
    return `<div class="slide-visual slide-visual-grid">${slide.visuals
      .map((entry) => {
        const visual = typeof entry === "string" ? { file: entry } : entry;
        return `<figure><img src="${shot(visual.file)}.png" alt="${escapeHtml(visual.label ?? slide.title)}" />${visual.label ? `<figcaption>${escapeHtml(visual.label)}</figcaption>` : ""}</figure>`;
      })
      .join("")}</div>`;
  }
  return `<div class="slide-visual${slide.contain ? " contain" : ""}"><img src="${shot(slide.visual)}.png" alt="${escapeHtml(slide.title)} — current RoboSats screen" /></div>`;
}

function renderCallout(slide) {
  const guide = slide.guide ?? "beep";
  return `<aside class="guide-callout">
    <span class="guide-avatar" data-guide="${guide}"><img src="${avatar(guide)}" alt="${guide === "beep" ? "Beep" : "Bop"}, generated with the RoboSats avatar renderer" /></span>
    <span class="guide-speech" data-guide="${guide}"><strong>${guide}</strong>${escapeHtml(slide.quip)}</span>
  </aside>`;
}

function renderTips(tips = []) {
  if (!tips.length) return "";
  return `<div class="slide-tips">${tips.map((tip) => `<span class="slide-tip">${escapeHtml(tip)}</span>`).join("")}</div>`;
}

function renderSources(sources = []) {
  if (!sources.length) return "";
  return `<div class="source-list">${sources
    .map(
      ([label, url]) =>
        `<a href="${escapeHtml(url)}"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(url)}</span></a>`
    )
    .join("")}</div>`;
}

function markerContainer(slideElement, slide) {
  if (!slide.visuals) return slideElement.querySelector(".slide-visual");
  const panelIndex = slide.target?.[2] ?? 0;
  return slideElement.querySelectorAll(".slide-visual figure")[panelIndex];
}

function drawPointers() {
  for (const slide of document.querySelectorAll(".slide:not(.slide-cover)")) {
    const avatarElement = slide.querySelector(".guide-avatar");
    const marker = slide.querySelector(".focus-marker");
    const path = slide.querySelector(".pointer-path");
    if (!avatarElement || !marker || !path) continue;
    const slideBounds = slide.getBoundingClientRect();
    const avatarBounds = avatarElement.getBoundingClientRect();
    const markerBounds = marker.getBoundingClientRect();
    const startX = avatarBounds.right - slideBounds.left - 5;
    const startY = avatarBounds.top + avatarBounds.height * 0.47 - slideBounds.top;
    const endX = markerBounds.left + markerBounds.width * 0.5 - slideBounds.left;
    const endY = markerBounds.top + markerBounds.height * 0.5 - slideBounds.top;
    const bend = Math.max(90, Math.min(240, Math.abs(endX - startX) * 0.28));
    path.setAttribute(
      "d",
      `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`
    );
  }
}

function scrollToSlide(value) {
  const index = Number(value ?? 0);
  slideElements[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function waitForImages() {
  return Promise.all(
    [...document.images].map((image) => {
      if (image.complete) return Promise.resolve();
      return new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      });
    })
  );
}

function shot(name) {
  return `${screenshotRoot}/${name}`;
}

function avatar(name) {
  return `${avatarRoot}/${name}.svg`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
