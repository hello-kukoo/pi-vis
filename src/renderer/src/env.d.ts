/// <reference types="vite/client" />

import type { PivisAPI } from "../../preload/index.js";

declare global {
  interface Window {
    pivis: PivisAPI;
  }
}
