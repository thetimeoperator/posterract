import path from "node:path";

// esbuild's JavaScript API is bundled into application.cjs, but its native
// executable must remain a real file on disk. Point the API at the executable
// before loading any of the compiler modules in the main application bundle.
const esbuildBinary = process.platform === "win32" ? "esbuild.exe" : "esbuild";
process.env.ESBUILD_BINARY_PATH = path.join(__dirname, esbuildBinary);

const cliMarker = process.argv.indexOf("--posterract-cli");
if (cliMarker >= 0) {
  const cli = path.join(__dirname, "..", "cli", "posterract.cjs");
  process.env.POSTERRACT_APP_PATH ??= path.join(__dirname, "..");
  process.env.POSTERRACT_CLI_FORCE_EXIT = "1";
  process.argv = [process.execPath, cli, ...process.argv.slice(cliMarker + 1)];
  require(cli);
} else {
  require("./application.cjs");
}
