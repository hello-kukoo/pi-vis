import { killRegisteredElectronProcesses } from "./electron-process-registry.mjs";

export default async function globalTeardown(): Promise<void> {
  await killRegisteredElectronProcesses();
}
