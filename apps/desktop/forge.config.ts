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
      path !== "/assets" &&
      !path.startsWith("/assets/"),
    osxSign: process.env.SKIP_SIGN ? undefined : {},
    osxNotarize:
      process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID
        ? {
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_PASSWORD,
            teamId: process.env.APPLE_TEAM_ID,
          }
        : undefined,
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
        section: "video",
        priority: "optional",
        maintainer: "Posterract",
        categories: ["AudioVideo", "Video"],
        icon: `${iconBase}.png`,
      },
    }),
    new MakerAppImage({
      options: {
        categories: ["AudioVideo", "Video"],
        icon: `${iconBase}.png`,
      },
    }),
  ],
};

export default config;
