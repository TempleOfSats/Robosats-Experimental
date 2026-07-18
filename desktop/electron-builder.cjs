const path = require("node:path");
const rootPackage = require("../package.json");

module.exports = {
  appId: "org.robosats.experimental",
  productName: "RoboSats Exp.",
  artifactName: `robosats-exp-${rootPackage.version}-\${os}-\${arch}.\${ext}`,
  directories: {
    app: "desktop",
    output: "desktop/release"
  },
  extraMetadata: {
    version: rootPackage.version
  },
  files: [
    "package.json",
    "build/app/**",
    "assets/**",
    "!node_modules{,/**/*}"
  ],
  extraResources: [
    {
      from: "dist",
      to: "web"
    },
    {
      from: "desktop/build/bin",
      to: "bin"
    }
  ],
  asar: true,
  compression: "maximum",
  npmRebuild: false,
  mac: {
    category: "public.app-category.finance",
    icon: "desktop/assets/icon.png",
    target: ["dmg"]
  },
  win: {
    icon: "desktop/assets/icon.png",
    target: ["nsis"]
  },
  linux: {
    category: "Finance",
    icon: "desktop/assets/icon.png",
    syncDesktopName: true,
    target: ["AppImage"]
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true
  },
  publish: null,
  afterPack: async (context) => {
    const executable = path.join(
      context.appOutDir,
      process.platform === "darwin"
        ? `${context.packager.appInfo.productFilename}.app/Contents/Resources/bin/robosats-arti`
        : process.platform === "win32"
          ? "resources/bin/robosats-arti.exe"
          : "resources/bin/robosats-arti"
    );
    if (process.platform !== "win32") {
      await require("node:fs/promises").chmod(executable, 0o755);
    }
  }
};
