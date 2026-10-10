const esbuild = require("esbuild");
esbuild.build({
  entryPoints: [process.env.AUDIT_WORK + "/entry.tsx"],
  bundle: true,
  outfile: process.env.AUDIT_WORK + "/bundle.js",
  format: "iife",
  tsconfig: process.env.AUDIT_WORK + "/tsconfig.json",
  jsx: "automatic",
  nodePaths: process.env.NODE_PATH.split(":"),
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  logLevel: "error",
}).then(() => console.log("bundle ok")).catch(() => process.exit(1));
