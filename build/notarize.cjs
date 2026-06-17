/**
 * Notarization hook for electron-builder.
 *
 * Called after the macOS build is signed. Only runs when Apple credentials
 * are present (APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID),
 * so local unsigned builds (npm run dist) work without any env vars.
 *
 * Required env vars for release builds:
 *   APPLE_ID                       — Apple ID email
 *   APPLE_APP_SPECIFIC_PASSWORD    — App-specific password (not iCloud password)
 *   APPLE_TEAM_ID                  — Team ID from Apple Developer account
 *   CSC_LINK / CSC_KEY_PASSWORD    — (optional) signing certificate + key password
 */

const { notarize } = require("@electron/notarize");

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  if (electronPlatformName !== "darwin") {
    return;
  }

  const appId = packager.appInfo.info._configuration.appId;
  const appName = packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const appleTeamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !appleTeamId) {
    console.log(
      "[notarize] Skipping notarization: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID must be set.",
    );
    return;
  }

  console.log(`[notarize] Notarizing ${appPath} with appBundleId ${appId}...`);

  await notarize({
    appBundleId: appId,
    appPath,
    appleId,
    appleIdPassword,
    teamId: appleTeamId,
  });

  console.log("[notarize] Notarization complete.");
};
