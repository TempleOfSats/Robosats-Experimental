/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular-dependencies",
      severity: "error",
      comment: "Cycles hide ownership and make startup, testing, and debugging unpredictable.",
      from: {},
      to: { circular: true }
    },
    {
      name: "production-does-not-import-tests",
      severity: "error",
      comment: "Test helpers needed by production belong in a normal module.",
      from: { pathNot: "[.](?:test|spec)[.](?:ts|tsx)$" },
      to: { path: "[.](?:test|spec)[.](?:ts|tsx)$" }
    },
    {
      name: "domains-do-not-depend-on-composition",
      severity: "error",
      comment: "Feature domains are composed by the application shell, never the other way around.",
      from: { path: "^src/domains/" },
      to: { path: "^src/(?:app|components/app)/" }
    },
    {
      name: "ui-primitives-remain-leaves",
      severity: "error",
      comment: "Reusable UI primitives may depend on lib utilities, not application or feature behavior.",
      from: {
        path: "^src/components/ui/",
        pathNot: "[.](?:test|spec)[.](?:ts|tsx)$"
      },
      to: { path: "^src/(?:app|components/app|domains)/" }
    },
    {
      name: "shared-lib-remains-domain-free",
      severity: "error",
      comment: "General utilities cannot know about React composition or product domains.",
      from: { path: "^src/lib/" },
      to: { path: "^src/(?:app|components|domains)/" }
    },
    {
      name: "transport-remains-infrastructure",
      severity: "error",
      comment: "Transport may use diagnostics and cryptographic header helpers, but not product features.",
      from: { path: "^src/domains/transport/" },
      to: {
        path: "^src/domains/",
        pathNot: "^src/domains/(?:crypto|diagnostics|transport)/"
      }
    },
    {
      name: "main-is-an-entry-point",
      severity: "error",
      comment: "No module imports the application entry point.",
      from: { pathNot: "^src/main[.]tsx$" },
      to: { path: "^src/main[.]tsx$" }
    }
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    enhancedResolveOptions: {
      conditionNames: ["import", "types", "default"],
      exportsFields: ["exports"],
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"]
    },
    includeOnly: "^src/",
    moduleSystems: ["es6"],
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: "specify"
  }
};
