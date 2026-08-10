import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const baseUrl = process.env.TUTORIAL_BASE_URL ?? "http://127.0.0.1:5173";
const rootDir = fileURLToPath(new URL("../", import.meta.url));
const screenshotDir = fileURLToPath(new URL("../docs/assets/tutorial/screenshots/", import.meta.url));
const avatarDir = fileURLToPath(new URL("../docs/assets/tutorial/avatars/", import.meta.url));
const viewport = { width: 1440, height: 900 };
const captureScope = process.env.TUTORIAL_CAPTURE_SCOPE ?? "all";

const syntheticOrders = [
  {
    id: 42001,
    type: 1,
    currency: 2,
    currencyCode: "EUR",
    amount: 500,
    has_range: false,
    is_swap: false,
    min_amount: 0,
    max_amount: 0,
    payment_method: "Revolut",
    premium: -0.8,
    satoshis: 535000,
    maker_nick: "CopperRiver842",
    maker_hash_id: "maker-preview",
    bond_size_sats: 16050,
    bond_size_percent: 3,
    coordinatorShortAlias: "lake"
  },
  {
    id: 42002,
    type: 1,
    currency: 2,
    currencyCode: "EUR",
    amount: null,
    has_range: true,
    is_swap: false,
    min_amount: 250,
    max_amount: 1000,
    payment_method: "Instant SEPA, Revolut",
    premium: 0.5,
    satoshis: 0,
    maker_nick: "HelpfulVeranda735",
    maker_hash_id: "orderbook-tutorial-two",
    bond_size_sats: 24000,
    bond_size_percent: 3,
    coordinatorShortAlias: "temple"
  },
  {
    id: 42003,
    type: 0,
    currency: 1,
    currencyCode: "USD",
    amount: 300,
    has_range: false,
    is_swap: false,
    min_amount: 0,
    max_amount: 0,
    payment_method: "Strike",
    premium: 1.2,
    satoshis: 319000,
    maker_nick: "CalmPottery219",
    maker_hash_id: "orderbook-tutorial-three",
    bond_size_sats: 9570,
    bond_size_percent: 3,
    coordinatorShortAlias: "lake"
  },
  {
    id: 42004,
    type: 1,
    currency: 20,
    currencyCode: "BRL",
    amount: 1200,
    has_range: false,
    is_swap: false,
    min_amount: 0,
    max_amount: 0,
    payment_method: "PIX",
    premium: 0,
    satoshis: 337000,
    maker_nick: "PatientHarbor404",
    maker_hash_id: "orderbook-tutorial-four",
    bond_size_sats: 10110,
    bond_size_percent: 3,
    coordinatorShortAlias: "temple"
  }
];

await mkdir(screenshotDir, { recursive: true });
await mkdir(avatarDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  args: ["--disable-dev-shm-usage", "--disable-gpu"],
  headless: true
});

try {
  if (captureScope === "all" || captureScope === "standard") await captureStandardJourney(browser);
  if (captureScope === "all" || captureScope === "trade") await captureTradeJourney(browser);
  if (captureScope === "all" || captureScope === "pro") await captureProJourney(browser);
} finally {
  await browser.close();
}

console.log(`Tutorial captures written under ${screenshotDir.replace(`${rootDir}/`, "")}`);

async function captureStandardJourney(browserInstance) {
  const context = await tutorialContext(browserInstance);
  const page = await context.newPage();

  try {
    await page.goto(`${baseUrl}/garage`, { waitUntil: "domcontentloaded" });
    await page.locator(".robot-wizard").waitFor({ state: "visible", timeout: 30_000 });
    await capture(page, "garage-empty");

    await page.getByRole("button", { name: "Generate my robot" }).click();
    const tokenInput = page.getByLabel("Robot token");
    await tokenInput.waitFor({ state: "visible" });
    await redactInput(tokenInput, "[Robot token hidden for tutorial]");
    await capture(page, "garage-backup");

    await page.locator(".token-review-step").getByRole("button", { name: "Continue" }).click();
    await page.locator(".identity-step .robot-avatar-ready").waitFor({ state: "visible", timeout: 20_000 });
    await capture(page, "garage-identity");

    await page.locator(".identity-step").getByRole("button", { name: "Continue" }).click();
    await page.locator(".garage-profile-stage").waitFor({ state: "visible", timeout: 30_000 });
    await capture(page, "garage-home");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    await capture(page, "navigation-mobile");
    await page.setViewportSize(viewport);
    await page.waitForTimeout(200);

    await seedOrderbook(page);
    await page.getByRole("button", { name: /Find a trade/ }).click();
    await page.locator(".guided-trade-dialog").waitFor({ state: "visible", timeout: 20_000 });
    await capture(page, "guided-side");

    await page.getByRole("button", { name: /Buy bitcoin/ }).click();
    await page
      .locator(".guided-trade-footer")
      .getByRole("button", { name: /Continue/ })
      .click();
    await capture(page, "guided-currency");

    const euroQuickChoice = page.locator(".guided-quick-choices").getByRole("button", { name: "EUR" });
    if (await euroQuickChoice.count()) await euroQuickChoice.click();
    await page
      .locator(".guided-trade-footer")
      .getByRole("button", { name: /Continue/ })
      .click();
    await page.locator(".guided-amount-field input").fill("500");
    await capture(page, "guided-amount");

    await page
      .locator(".guided-trade-footer")
      .getByRole("button", { name: /Continue/ })
      .click();
    const revolutQuickChoice = page.locator(".guided-quick-choices").getByRole("button", { name: "Revolut" });
    if (await revolutQuickChoice.count()) {
      await revolutQuickChoice.click();
    } else {
      await chooseImageSelectOption(page, "Select payment method", "Revolut");
    }
    await capture(page, "guided-method");

    await page
      .locator(".guided-trade-footer")
      .getByRole("button", { name: /Continue/ })
      .click();
    await page
      .getByText(/matching offer/)
      .first()
      .waitFor({ state: "visible", timeout: 10_000 });
    await capture(page, "guided-results");

    await page.getByRole("button", { name: "Close guided trade" }).click();
    await page.goto(`${baseUrl}/offers`, { waitUntil: "domcontentloaded" });
    await page.locator(".orderbook-layout").waitFor({ state: "visible", timeout: 30_000 });
    await seedOrderbook(page);
    await page.locator(".offer-row").first().waitFor({ state: "visible", timeout: 10_000 });
    await capture(page, "orderbook");

    await page.locator(".offer-row").first().click();
    await page.locator(".take-offer-sheet").waitFor({ state: "visible", timeout: 10_000 });
    await capture(page, "offer-review");

    await page.getByRole("button", { name: "Close take offer" }).click();
    await page.goto(`${baseUrl}/create`, { waitUntil: "domcontentloaded" });
    await page.locator(".maker-wizard-card").waitFor({ state: "visible", timeout: 30_000 });
    await seedFederation(page);
    await capture(page, "create-side");

    await page
      .locator(".maker-wizard-footer")
      .getByRole("button", { name: /Continue/ })
      .click();
    await page.getByPlaceholder("Type the amount").fill("500");
    await chooseImageSelectOption(page, "Select payment method", "Revolut");
    await capture(page, "create-amount");

    await page.locator(".maker-amount-advanced summary").click();
    await capture(page, "create-advanced");
    await page.locator(".maker-amount-advanced summary").click();

    await page.locator(".maker-wizard-footer").getByRole("button", { name: "Review offer" }).click();
    await page.getByText("Review before publishing").waitFor({ state: "visible" });
    await capture(page, "create-review");
  } finally {
    await context.close();
  }
}

async function captureTradeJourney(browserInstance) {
  const context = await tutorialContext(browserInstance);
  const page = await context.newPage();
  const scenarios = [
    "maker-bond",
    "public",
    "taker-wait",
    "setup-buyer",
    "setup-seller",
    "escrow-wait",
    "payout-wait",
    "chat-buyer",
    "chat-seller",
    "routing-auto",
    "routing-retry",
    "success"
  ];

  try {
    for (const scenario of scenarios) {
      await page.goto(`${baseUrl}/order/lake/95955?tradePreview=${scenario}&tradeLab=1`, {
        waitUntil: "domcontentloaded"
      });
      await page.locator(".trade-layout").waitFor({ state: "visible", timeout: 30_000 });

      if (["maker-bond", "setup-seller"].includes(scenario)) {
        await redactInvoiceQr(page);
      }
      if (["chat-buyer", "chat-seller"].includes(scenario)) {
        await redactChat(page);
      }

      if (scenario === "chat-buyer") await exportFixtureAvatars(page);
      if (scenario === "success") await correctTutorialFeeLabel(page);
      await capture(page, `trade-${scenario}`);
    }
  } finally {
    await context.close();
  }
}

async function captureProJourney(browserInstance) {
  const context = await tutorialContext(browserInstance, { acceptDownloads: true });
  const page = await context.newPage();

  try {
    await page.goto(`${baseUrl}/settings`, { waitUntil: "domcontentloaded" });
    await page.getByRole("switch", { name: "Pro Mode" }).waitFor({ state: "visible", timeout: 30_000 });
    await capture(page, "pro-settings");

    const preferencesUrl = await loadedModuleUrl(page, "/proPreferencesStore.ts");
    await page.evaluate(async (moduleUrl) => {
      const { useProPreferencesStore } = await import(moduleUrl);
      useProPreferencesStore.getState().setEnabled(true);
    }, preferencesUrl);
    await page.goto(`${baseUrl}/pro`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Set up a new Fleet/ }).waitFor({ state: "visible", timeout: 30_000 });
    await capture(page, "pro-setup");

    await page.getByRole("button", { name: /Set up a new Fleet/ }).click();
    const fleetKey = page.locator(".pro-garage-token-value code");
    await fleetKey.waitFor({ state: "visible", timeout: 10_000 });
    await redactText(fleetKey, "[Fleet key hidden for tutorial]");
    await capture(page, "pro-fleet-backup");

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download Fleet key" }).click();
    await download;
    await redactText(fleetKey, "[Fleet key hidden for tutorial]");
    await page.getByRole("button", { name: "Continue to Trade Desk" }).click();
    await page.locator("[role=dialog]").waitFor({ state: "hidden", timeout: 30_000 });
    await page.locator(".pro-workspace-surface").waitFor({ state: "visible", timeout: 30_000 });
    await seedProWorkspace(page);

    await page.getByRole("tab", { name: "Trades" }).click();
    await page.locator(".pro-trade-list").waitFor({ state: "visible", timeout: 10_000 });
    await capture(page, "pro-trades");

    await page.getByRole("tab", { name: "Robot Fleet" }).click();
    await page.locator(".pro-robot-list").waitFor({ state: "visible", timeout: 10_000 });
    await capture(page, "pro-robots");

    const firstMenu = page.locator('summary[aria-label^="More actions for"]').first();
    await firstMenu.click();
    await capture(page, "pro-robot-menu");
    await firstMenu.click();

    await page.getByRole("tab", { name: "Trades" }).click();
    await page.getByRole("button", { name: "Create an offer", exact: true }).click();
    await page.locator(".pro-create-robot-picker").waitFor({ state: "visible", timeout: 10_000 });
    await capture(page, "pro-robot-picker");
    await page.getByRole("button", { name: "Close robot selector" }).click();

    await page.getByRole("button", { name: "Offer presets", exact: true }).click();
    await page.locator(".pro-presets-sheet").waitFor({ state: "visible", timeout: 10_000 });
    await capture(page, "pro-presets");
    await page.getByRole("button", { name: "Close offer presets" }).click();

    await page.getByRole("tab", { name: "History" }).click();
    await page.locator(".pro-history-list").waitFor({ state: "visible", timeout: 10_000 });
    await capture(page, "pro-history");
    await page.locator('[aria-label^="Open finished order"]').first().click();
    await capture(page, "pro-history-detail");
    await page.getByRole("button", { name: "Close trade history" }).click();

    await page.getByRole("button", { name: "Abandon Fleet", exact: true }).click();
    await page.getByText("Abandon Fleet?").waitFor({ state: "visible" });
    await capture(page, "pro-abandon");
  } finally {
    await context.close();
  }
}

async function tutorialContext(browserInstance, options = {}) {
  const context = await browserInstance.newContext({
    acceptDownloads: options.acceptDownloads ?? false,
    colorScheme: "dark",
    locale: "en-US",
    viewport
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      void route.continue();
    } else {
      void route.abort();
    }
  });
  return context;
}

async function capture(page, name) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const pendingVisibleImages = [...document.images]
      .filter((image) => {
        const bounds = image.getBoundingClientRect();
        return !image.complete && bounds.width > 0 && bounds.height > 0;
      })
      .map(
        (image) =>
          new Promise((resolve) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", resolve, { once: true });
          })
      );
    await Promise.race([
      Promise.all(pendingVisibleImages),
      new Promise((resolve) => window.setTimeout(resolve, 1_500))
    ]);
  });
  await page.waitForTimeout(180);
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: `${screenshotDir}/${name}.png`
  });
}

async function seedOrderbook(page) {
  const orderbookUrl = await loadedModuleUrl(page, "/orderbookStore.ts");
  await page.evaluate(
    async ({ moduleUrl, orders }) => {
      const { useOrderbookStore } = await import(moduleUrl);
      useOrderbookStore.setState({
        orders: orders.map((order) => ({
          ...order,
          created_at: new Date(Date.now() - 30 * 60_000).toISOString(),
          expires_at: new Date(Date.now() + 18 * 60 * 60_000).toISOString()
        })),
        loading: false,
        refreshing: false,
        cacheState: "fresh",
        error: undefined,
        lastUpdated: Date.now(),
        sourceConnection: "nostr",
        sourceNetwork: "mainnet",
        sourceOrigin: "clearnet"
      });
    },
    { moduleUrl: orderbookUrl, orders: syntheticOrders }
  );
  await page.waitForTimeout(100);
}

async function seedFederation(page) {
  const federationUrl = await loadedModuleUrl(page, "/federationStore.ts");
  await page.evaluate(
    async ({ moduleUrl, localBaseUrl }) => {
      const { useFederationStore } = await import(moduleUrl);
      const now = Date.now();
      useFederationStore.setState((state) => ({
        ...state,
        lastRefreshed: now,
        refreshing: false,
        coordinators: state.coordinators.map((coordinator) => ({
          ...coordinator,
          enabled: true,
          error: undefined,
          lastCheckedAt: now,
          loading: false,
          online: true,
          url: coordinator.url || `${localBaseUrl}/tutorial-coordinator/${coordinator.shortAlias}`,
          info: coordinator.info ?? {
            num_public_buy_orders: 4,
            num_public_sell_orders: 6,
            book_liquidity: 2_100_000,
            active_robots_today: 18,
            last_day_nonkyc_btc_premium: 0.4,
            last_day_volume: 0.08,
            lifetime_volume: 42,
            maker_fee: 0.002,
            taker_fee: 0.002,
            bond_size: 3,
            min_order_size: 20_000,
            max_order_size: 5_000_000,
            swap_enabled: true,
            max_swap: 5_000_000,
            current_swap_fee_rate: 0.002,
            notice_severity: "none",
            notice_message: ""
          },
          limits: coordinator.limits ?? {
            EUR: { code: "EUR", price: 100_000, min_amount: 20, max_amount: 5_000 },
            USD: { code: "USD", price: 110_000, min_amount: 20, max_amount: 5_000 }
          }
        }))
      }));
    },
    { moduleUrl: federationUrl, localBaseUrl: baseUrl }
  );
  await page.waitForTimeout(100);
}

async function seedProWorkspace(page) {
  const moduleUrls = Object.fromEntries(
    await Promise.all(
      [
        "/garageVaultStore.ts",
        "/garageStore.ts",
        "/robotIdentity.ts",
        "/proTradeIndexStore.ts",
        "/proRuntime.ts",
        "/portableSettingsStore.ts"
      ].map(async (fragment) => [fragment, await loadedModuleUrl(page, fragment)])
    )
  );
  moduleUrls["/robonameClient.ts"] = new URL("/src/domains/identity/robonameClient.ts", baseUrl).href;

  await page.evaluate(async (urls) => {
    const [
      { garageSlotsFromManifest, useGarageVaultStore },
      { useGarageStore },
      { deriveRobotIdentity },
      { generateRoboname },
      { useProTradeIndexStore },
      { stopProRuntime },
      { usePortableSettingsStore }
    ] = await Promise.all([
      import(urls["/garageVaultStore.ts"]),
      import(urls["/garageStore.ts"]),
      import(urls["/robotIdentity.ts"]),
      import(urls["/robonameClient.ts"]),
      import(urls["/proTradeIndexStore.ts"]),
      import(urls["/proRuntime.ts"]),
      import(urls["/portableSettingsStore.ts"])
    ]);

    stopProRuntime();
    useGarageStore.getState().hydrate();

    for (let index = 0; index < 5; index += 1) {
      await useGarageVaultStore.getState().createDerivedRobot();
    }

    const robots = [];
    const materialized = garageSlotsFromManifest(useGarageVaultStore.getState().manifest);
    for (const [index, entry] of materialized.entries()) {
      const identity = deriveRobotIdentity(entry.token);
      const nickname = generateRoboname(identity.hashId);
      await useGarageVaultStore.getState().renameRobot(entry.token, nickname);
      const orderId = index < 4 ? 92450 + index : undefined;
      const lastOrderId = index === 4 ? 91881 : orderId;
      useGarageStore.getState().addSlot({
        ...identity,
        nickname,
        managedBy: "fleet",
        activeOrderId: orderId,
        lastOrderId,
        earnedRewards: 0,
        robots: {
          local: {
            token: entry.token,
            shortAlias: "local",
            nostrPubKey: identity.nostrPubKey,
            tokenSHA256: identity.tokenSHA256,
            earnedRewards: 0
          },
          lake: {
            token: entry.token,
            shortAlias: "lake",
            nostrPubKey: identity.nostrPubKey,
            tokenSHA256: identity.tokenSHA256,
            activeOrderId: orderId,
            lastOrderId,
            found: true,
            lastCheckedAt: Date.now()
          }
        }
      });
      robots.push({ ...identity, nickname, orderId });
    }

    const now = Date.now();
    const expiresSoon = new Date(now + 54 * 60_000).toISOString();
    const expiresLater = new Date(now + 12 * 60 * 60_000).toISOString();
    const commonOrder = {
      type: 1,
      currency: 2,
      amount: 500,
      payment_method: "Instant SEPA",
      premium: 0.5,
      satoshis: 535000,
      satoshis_now: 535000,
      trade_satoshis: 531200,
      shortAlias: "lake"
    };
    const snapshots = [
      {
        robot: robots[0],
        order: {
          ...commonOrder,
          id: robots[0].orderId,
          status: 6,
          is_maker: false,
          is_taker: true,
          is_buyer: true,
          is_seller: false,
          expires_at: expiresSoon
        },
        renewable: false
      },
      {
        robot: robots[1],
        order: {
          ...commonOrder,
          id: robots[1].orderId,
          status: 7,
          is_maker: true,
          is_taker: false,
          is_buyer: true,
          is_seller: false,
          expires_at: expiresSoon
        },
        renewable: false
      },
      {
        robot: robots[2],
        order: {
          ...commonOrder,
          id: robots[2].orderId,
          status: 1,
          is_maker: true,
          is_taker: false,
          is_buyer: false,
          is_seller: true,
          expires_at: expiresLater,
          maker_locked: true
        },
        renewable: false
      },
      {
        robot: robots[3],
        order: {
          ...commonOrder,
          id: robots[3].orderId,
          status: 5,
          is_maker: true,
          is_taker: false,
          is_buyer: false,
          is_seller: true,
          expires_at: new Date(now - 60_000).toISOString()
        },
        renewable: true
      }
    ].map(({ robot, order, renewable }) => ({
      key: `${robot.tokenSHA256}:lake:${order.id}`,
      locator: { slotId: robot.tokenSHA256, shortAlias: "lake", orderId: order.id },
      nickname: robot.nickname,
      hashId: robot.hashId,
      order,
      activeOrderId: order.id,
      lastOrderId: order.id,
      renewable,
      released: false,
      freshness: "fresh",
      updatedAt: now,
      changedAt: now
    }));
    const syncBySlot = Object.fromEntries(
      robots.map((robot) => [
        robot.tokenSHA256,
        {
          slotId: robot.tokenSHA256,
          epoch: 1,
          inFlight: false,
          lastAttemptAt: now,
          lastSuccessAt: now,
          nextEligibleAt: now + 60 * 60_000
        }
      ])
    );
    useProTradeIndexStore
      .getState()
      .hydrateRuntimeCache(Object.fromEntries(snapshots.map((snapshot) => [snapshot.key, snapshot])), syncBySlot);

    usePortableSettingsStore.getState().initialize();
    usePortableSettingsStore.getState().savePreset({
      name: "Weekly EUR buy",
      direction: 0,
      isSwap: false,
      currency: "EUR",
      amount: "500",
      paymentMethods: ["Instant SEPA", "Revolut"],
      premium: 0,
      bond: 3,
      publicDuration: 43200,
      escrowDuration: 10800,
      description: "",
      password: ""
    });
    usePortableSettingsStore.getState().savePreset({
      name: "Private USD sell",
      direction: 1,
      isSwap: false,
      currency: "USD",
      minAmount: "250",
      maxAmount: "1000",
      paymentMethods: ["Strike"],
      premium: 1,
      bond: 3,
      publicDuration: 21600,
      escrowDuration: 10800,
      description: "",
      password: "tutorial-placeholder"
    });

    const historyEntries = [
      ["completed", "buyer", robots[0], 92110, 500, "Revolut"],
      ["collaboratively-cancelled", "seller", robots[1], 92111, 350, "Instant SEPA"],
      ["dispute-won", "buyer", robots[2], 92112, 700, "Bank transfer"],
      ["dispute-lost", "seller", robots[3], 92113, 250, "PIX"]
    ].map(([outcome, role, robot, orderId, amount, paymentMethod], index) => ({
      id: `tutorial-history-${index}`,
      slotId: robot.tokenSHA256,
      robotName: robot.nickname,
      robotHashId: robot.hashId,
      coordinatorShortAlias: "lake",
      orderId,
      role,
      origin: index % 2 === 0 ? "maker" : "taker",
      amount,
      currency: index === 3 ? 20 : 2,
      paymentMethod,
      premium: index === 2 ? 1 : 0,
      satoshis: Math.round(Number(amount) * 1060),
      outcome,
      completedAt: now - (index + 1) * 24 * 60 * 60_000,
      revision: 1,
      deviceId: "00000000000000000000000000000000",
      updatedAt: now - (index + 1) * 24 * 60 * 60_000
    }));
    const currentVault = useGarageVaultStore.getState();
    const history = {
      format: "robosats-exp-trade-history",
      version: 1,
      deviceId: "00000000000000000000000000000000",
      revision: 1,
      updatedAt: now,
      entries: historyEntries
    };
    const envelope = currentVault.envelope
      ? { ...currentVault.envelope, outbox: [], observed: { tutorial: {} }, history }
      : currentVault.envelope;
    useGarageVaultStore.setState({
      status: "ready",
      syncStatus: "up-to-date",
      lastSyncAt: now,
      envelope,
      history
    });
  }, moduleUrls);

  await page.waitForFunction(() => document.querySelectorAll(".robot-avatar-ready").length >= 5, null, {
    timeout: 30_000
  });
  await page.waitForTimeout(250);
}

async function loadedModuleUrl(page, fragment) {
  const moduleUrl = await page.evaluate((needle) => {
    const matches = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => name.includes(needle));
    return matches.at(-1) ?? "";
  }, fragment);
  if (!moduleUrl) throw new Error(`The application did not load ${fragment}.`);
  return moduleUrl;
}

async function chooseImageSelectOption(page, label, option) {
  const input = page.getByRole("combobox", { name: label });
  await input.click();
  await input.fill(option);
  await input.press("Enter");
}

async function redactInput(locator, replacement) {
  await locator.evaluate((element, value) => {
    element.type = "text";
    element.value = value;
    element.setAttribute("value", value);
  }, replacement);
}

async function redactText(locator, replacement) {
  await locator.evaluate((element, value) => {
    element.textContent = value;
  }, replacement);
}

async function redactInvoiceQr(page) {
  const shell = page.locator(".payment-qr-shell");
  if (!(await shell.count())) return;
  await shell.evaluate((element) => {
    element.replaceChildren();
    const note = document.createElement("span");
    note.textContent = "Private invoice hidden";
    note.style.cssText = [
      "align-items:center",
      "background:#f6f3ef",
      "border-radius:10px",
      "color:#171315",
      "display:flex",
      "font:700 16px Public Sans, sans-serif",
      "height:100%",
      "justify-content:center",
      "letter-spacing:.01em",
      "min-height:220px",
      "padding:24px",
      "text-align:center",
      "width:100%"
    ].join(";");
    element.append(note);
  });
}

async function redactChat(page) {
  await page.locator(".chat-bubble p").evaluateAll((messages) => {
    messages.forEach((message, index) => {
      message.textContent = index === 0 ? "[Encrypted payment details hidden]" : "[Encrypted confirmation hidden]";
    });
  });
}

async function correctTutorialFeeLabel(page) {
  const feeValue = page.locator(".trade-receipt-rows > div").filter({ hasText: "Trade fee" }).locator("dd");
  await feeValue.waitFor({ state: "visible", timeout: 10_000 });
  await redactText(feeValue, "1,254 sats (0.15%)");
}

async function exportFixtureAvatars(page) {
  const participantImages = page.locator(".chat-participants .robot-avatar img");
  await participantImages.nth(1).waitFor({ state: "visible", timeout: 20_000 });
  const sources = await participantImages.evaluateAll((images) => images.slice(0, 2).map((image) => image.src));
  for (const [index, source] of sources.entries()) {
    const match = source.match(/^data:image\/svg\+xml;base64,(.+)$/);
    if (!match) throw new Error("The tutorial avatar was not rendered as an SVG data URL.");
    const filename = index === 0 ? "beep.svg" : "bop.svg";
    await writeFile(`${avatarDir}/${filename}`, Buffer.from(match[1], "base64"));
  }
}
