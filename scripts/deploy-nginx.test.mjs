import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const deployScript = fileURLToPath(new URL("./deploy-nginx.mjs", import.meta.url));
const cspCheckScript = fileURLToPath(new URL("./check-web-csp.mjs", import.meta.url));
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("direct Nginx deployment", () => {
  it("installs and validates the shared security headers before replacing the live site", () => {
    const fixture = createFixture();
    const result = runDeploy(fixture);

    expect(result.status).toBe(0);
    const commands = readFileSync(fixture.commandLog, "utf8").trim().split("\n");
    const nextHeaders = `${fixture.headersTarget}.next-${result.pid}`;
    const installHeaders = `install -m 0644 ${join(fixture.root, "nodeapp/security-headers.conf")} ${nextHeaders}`;
    const promoteHeaders = `mv ${nextHeaders} ${fixture.headersTarget}`;
    const inspectConfig = "nginx -T";
    const validateConfig = "nginx -t";
    const replaceSite = `mv ${fixture.target}.next-${result.pid} ${fixture.target}`;

    expect(commands).toContain(installHeaders);
    expect(commands).toContain(promoteHeaders);
    expect(commands).toContain(inspectConfig);
    expect(commands).toContain(validateConfig);
    expect(commands).toContain(replaceSite);
    expect(commands.indexOf(installHeaders)).toBeLessThan(commands.indexOf(promoteHeaders));
    expect(commands.indexOf(promoteHeaders)).toBeLessThan(commands.indexOf(inspectConfig));
    expect(commands.indexOf(inspectConfig)).toBeLessThan(commands.indexOf(validateConfig));
    expect(commands.indexOf(validateConfig)).toBeLessThan(commands.indexOf(replaceSite));
  });

  it("fails before invoking sudo when the shared security headers are missing", () => {
    const fixture = createFixture({ includeSecurityHeaders: false });
    const result = runDeploy(fixture);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Missing shared Nginx security headers");
    expect(readFileSync(fixture.commandLog, "utf8")).toBe("");
  });

  it("fails before invoking sudo when the production build and CSP disagree", () => {
    const fixture = createFixture({ validCsp: false });
    const result = runDeploy(fixture);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must contain one active CSP header");
    expect(readFileSync(fixture.commandLog, "utf8")).toBe("");
  });

  it("rejects an inline-script hash outside script-src", () => {
    const fixture = createFixture({ misplacedScriptHash: true });
    const result = runDeploy(fixture);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing inline-script hashes");
    expect(readFileSync(fixture.commandLog, "utf8")).toBe("");
  });

  it("rejects a conflicting companion security header", () => {
    const fixture = createFixture({ conflictingHeader: true });
    const result = runDeploy(fixture);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("exactly one canonical directive");
    expect(readFileSync(fixture.commandLog, "utf8")).toBe("");
  });

  it("removes the candidate headers when Nginx validation fails", () => {
    const fixture = createFixture();
    const result = runDeploy(fixture, { failSudoCommand: "nginx -t" });
    const commands = readFileSync(fixture.commandLog, "utf8").trim().split("\n");

    expect(result.status).not.toBe(0);
    expect(commands).toContain(`rm -f ${fixture.headersTarget}`);
    expect(commands).not.toContain(`mv ${fixture.target}.next-${result.pid} ${fixture.target}`);
  });

  it("restores the previous site and headers when reload fails", () => {
    const fixture = createFixture({ existingSecurityHeaders: true });
    const result = runDeploy(fixture, { failSudoCommand: "nginx -s reload" });
    const commands = readFileSync(fixture.commandLog, "utf8").trim().split("\n");
    const reload = commands.indexOf("nginx -s reload");

    expect(result.status).not.toBe(0);
    expect(commands.indexOf(`rm -rf ${fixture.target}`)).toBeGreaterThan(reload);
    expect(commands.indexOf(`mv ${fixture.target}.previous ${fixture.target}`)).toBeGreaterThan(reload);
    expect(
      commands.indexOf(`mv ${fixture.headersTarget}.previous-${result.pid} ${fixture.headersTarget}`)
    ).toBeGreaterThan(reload);
  });

  it("rejects a live server config without MIME types", () => {
    const fixture = createFixture({ activeHasMimeTypes: false });
    const result = runDeploy(fixture);
    const commands = readFileSync(fixture.commandLog, "utf8").trim().split("\n");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Active Nginx config has no MIME types");
    expect(commands).not.toContain(`mv ${fixture.target}.next-${result.pid} ${fixture.target}`);
  });

  it("rejects a live server config that omits the shared headers", () => {
    const fixture = createFixture({ activeIncludesSecurityHeaders: false });
    const result = runDeploy(fixture);
    const commands = readFileSync(fixture.commandLog, "utf8").trim().split("\n");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Active Nginx server does not include the shared security headers");
    expect(commands).not.toContain(`mv ${fixture.target}.next-${result.pid} ${fixture.target}`);
  });

  it("rejects a live location that drops inherited security headers", () => {
    const fixture = createFixture({ activeLocationIncludesSecurityHeaders: false });
    const result = runDeploy(fixture);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Active Nginx location omits the shared security headers");
  });

  it("reports a rollback command that also fails", () => {
    const fixture = createFixture({ existingSecurityHeaders: true });
    const rollbackCommand = `mv ${fixture.target}.previous ${fixture.target}`;
    const result = runDeploy(fixture, {
      failRollbackCommand: rollbackCommand,
      failSudoCommand: "nginx -s reload"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`Rollback command failed: sudo ${rollbackCommand}`);
  });
});

function createFixture({
  activeHasMimeTypes = true,
  activeIncludesSecurityHeaders = true,
  activeLocationIncludesSecurityHeaders = true,
  conflictingHeader = false,
  existingSecurityHeaders = false,
  includeSecurityHeaders = true,
  misplacedScriptHash = false,
  validCsp = true
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "robosats-nginx-deploy-"));
  temporaryDirectories.push(root);
  const commandLog = join(root, "sudo.log");
  const fakeBin = join(root, "bin");
  const target = join(root, "live");
  const headersTarget = join(root, "security-headers.conf");

  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });
  mkdirSync(join(root, "deploy"), { recursive: true });
  mkdirSync(join(root, "nodeapp"), { recursive: true });
  mkdirSync(target, { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  copyFileSync(deployScript, join(root, "scripts/deploy-nginx.mjs"));
  copyFileSync(cspCheckScript, join(root, "scripts/check-web-csp.mjs"));
  const inlineScript = "boot();";
  const hash = createHash("sha256").update(inlineScript).digest("base64");
  writeFileSync(join(root, "dist/index.html"), `<!doctype html><script>${inlineScript}</script>\n`);
  if (includeSecurityHeaders) {
    const comment = validCsp ? "" : "# ";
    const scriptPolicy = misplacedScriptHash
      ? `script-src 'self'; style-src 'sha256-${hash}'`
      : `script-src 'self' 'sha256-${hash}'`;
    writeFileSync(
      join(root, "nodeapp/security-headers.conf"),
      `${comment}add_header Content-Security-Policy "default-src 'self'; ${scriptPolicy}; object-src 'none'; frame-ancestors 'none'" always;\n` +
        "add_header X-Content-Type-Options nosniff always;\n" +
        "add_header X-Frame-Options DENY always;\n" +
        (conflictingHeader ? "add_header X-Frame-Options SAMEORIGIN always;\n" : "") +
        "add_header Referrer-Policy no-referrer always;\n" +
        'add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;\n'
    );
  }
  const nginxConfig =
    "events {}\nhttp {\n  server {\n    include /etc/nginx/security-headers.conf;\n" +
    "    location / {\n      include /etc/nginx/security-headers.conf;\n    }\n  }\n}\n";
  writeFileSync(join(root, "deploy/nginx.conf"), nginxConfig);
  writeFileSync(join(root, "nodeapp/nginx.conf"), nginxConfig);
  if (existingSecurityHeaders) writeFileSync(headersTarget, "previous policy\n");
  writeFileSync(commandLog, "");
  const fakeSudo = join(fakeBin, "sudo");
  writeFileSync(
    fakeSudo,
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$SUDO_LOG"\n' +
      'if [ -n "$FAIL_SUDO_COMMAND" ] && [ "$*" = "$FAIL_SUDO_COMMAND" ]; then exit 1; fi\n' +
      'if [ -n "$FAIL_ROLLBACK_COMMAND" ] && [ "$*" = "$FAIL_ROLLBACK_COMMAND" ]; then exit 1; fi\n' +
      'if [ "$*" = "nginx -T" ]; then printf "%s" "$LIVE_NGINX_CONFIG"; fi\n'
  );
  chmodSync(fakeSudo, 0o755);

  const liveInclude = activeIncludesSecurityHeaders ? `    include ${headersTarget};\n` : "";
  const liveLocationInclude = activeLocationIncludesSecurityHeaders ? `      include ${headersTarget};\n` : "";
  const liveMimeTypes = activeHasMimeTypes
    ? "  types {\n    text/html html;\n    application/javascript js;\n    image/svg+xml svg;\n  }\n"
    : "";
  const liveNginxConfig =
    `events {}\nhttp {\n${liveMimeTypes}  server {\n    root ${target};\n${liveInclude}` +
    `    location / {\n${liveLocationInclude}    }\n  }\n}\n`;

  return { commandLog, fakeBin, headersTarget, liveNginxConfig, root, target };
}

function runDeploy(fixture, { failRollbackCommand = "", failSudoCommand = "" } = {}) {
  return spawnSync(process.execPath, [join(fixture.root, "scripts/deploy-nginx.mjs")], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: fixture.fakeBin,
      ROBOSATS_NGINX_ROOT: fixture.target,
      ROBOSATS_NGINX_SECURITY_HEADERS: fixture.headersTarget,
      SUDO_LOG: fixture.commandLog,
      FAIL_ROLLBACK_COMMAND: failRollbackCommand,
      FAIL_SUDO_COMMAND: failSudoCommand,
      LIVE_NGINX_CONFIG: fixture.liveNginxConfig
    }
  });
}
