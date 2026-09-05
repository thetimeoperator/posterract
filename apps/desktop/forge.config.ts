import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerZIP } from "@electron-forge/maker-zip";
import MakerSquirrel from "@electron-forge/maker-squirrel";
import MakerDeb from "@electron-forge/maker-deb";
import MakerAppImage from "@reforged/maker-appimage";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = dirname(fileURLToPath(import.meta.url));
const iconBase = resolve(desktopRoot, "assets", "icon");
const desktopIcon =
  process.platform === "darwin" ? `${iconBase}.icns` : process.platform === "win32" ? `${iconBase}.ico` : `${iconBase}.png`;

// Notarization needs all three, and Apple rejects the submission if any is wrong.
// Kept as one value so the packager and the postMake staple below cannot disagree.
const appleCredentials =
  process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID
    ? {
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID,
      }
    : undefined;

const config: ForgeConfig = {
  packagerConfig: {
    name: "Posterract",
    executableName: "Posterract",
    icon: desktopIcon,
    appBundleId: "com.posterract.desktop",
    appCategoryType: "public.app-category.video",
    protocols: [{ name: "Posterract", schemes: ["posterract"] }],
    prune: false,
    ignore: (path) =>
      path !== "" &&
      path !== "/package.json" &&
      path !== "/dist" &&
      !path.startsWith("/dist/") &&
      path !== "/renderer" &&
      !path.startsWith("/renderer/") &&
      path !== "/cli" &&
      !path.startsWith("/cli/") &&
      path !== "/sdk" &&
      !path.startsWith("/sdk/") &&
      path !== "/docs" &&
      !path.startsWith("/docs/") &&
      path !== "/examples" &&
      !path.startsWith("/examples/") &&
      path !== "/skill" &&
      !path.startsWith("/skill/") &&
      path !== "/skills" &&
      !path.startsWith("/skills/") &&
      path !== "/assets" &&
      !path.startsWith("/assets/"),
    osxSign: process.env.SKIP_SIGN ? undefined : {},
    osxNotarize: appleCredentials,
  },
  makers: [
    new MakerZIP({}, ["darwin"]),
    new MakerDMG({ name: `Posterract-${process.arch}` }),
    new MakerSquirrel({
      name: "posterract",
      authors: "Posterract",
      description: "Local, agent-native video editing with Posterract cloud publishing.",
      setupIcon: `${iconBase}.ico`,
    }),
    new MakerZIP({}, ["win32"]),
    new MakerDeb({
      options: {
        name: "posterract",
        productName: "Posterract",
        genericName: "Video Editor",
        description: "Agent-native local video editor",
        productDescription: "Edit local video compositions with coding agents and publish explicitly through Posterract.",
        bin: "Posterract",
        section: "video",
        priority: "optional",
        maintainer: "Posterract",
        categories: ["AudioVideo", "Video"],
        icon: `${iconBase}.png`,
      },
    }),
    new MakerAppImage({
      options: {
        // Defaults to the package name, posterract-desktop, which is not what
        // packagerConfig.executableName produces.
        bin: "Posterract",
        categories: ["AudioVideo", "Video"],
        icon: `${iconBase}.png`,
      },
    }),
  ],
  hooks: {
    // An unsigned build fails loudly — @electron/osx-sign throws when it finds no
    // identity. A signed-but-unnotarized one does not: it produces a .dmg that looks
    // like a finished release and is refused on every Mac but the one that built it.
    // Refuse to reach the makers in that state; local builds opt out with SKIP_SIGN=1.
    preMake: async () => {
      if (process.platform !== "darwin" || process.env.SKIP_SIGN || appleCredentials) return;
      throw new Error(
        "Refusing to make an unnotarized macOS release: it will be rejected on every other Mac. " +
          "Set APPLE_ID, APPLE_PASSWORD (an app-specific password) and APPLE_TEAM_ID, " +
          "or pass SKIP_SIGN=1 for a local build.",
      );
    },
    // The app inside the image is stapled during packaging, but the .dmg wrapper is
    // what carries the quarantine flag on download, and Gatekeeper judges it first.
    // Notarizing the wrapper too is what makes a fresh download open on a double click.
    postMake: async (_config, results) => {
      if (!appleCredentials) return results;
      const { notarize } = await import("@electron/notarize");
      for (const result of results) {
        if (result.platform !== "darwin") continue;
        for (const artifact of result.artifacts.filter((path) => path.endsWith(".dmg"))) {
          await notarize({ appPath: artifact, ...appleCredentials });
        }
      }
      return results;
    },
  },
};

export default config;
