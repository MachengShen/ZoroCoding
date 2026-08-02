import {
  BrowserWindow,
  shell,
  type BrowserWindowConstructorOptions,
  type WebContents,
} from "electron";

export function buildWindowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 620,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#000000",
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  };
}

export function configureWebContentsSecurity(
  webContents: WebContents,
  openExternal: (url: string) => Promise<void> = shell.openExternal,
): void {
  webContents.session.setPermissionRequestHandler(
    (_requestingWebContents, _permission, callback) => callback(false),
  );
  webContents.session.setPermissionCheckHandler(() => false);
  webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) {
      void openExternal(url);
    }
    return { action: "deny" };
  });
  webContents.on("will-navigate", (event) => event.preventDefault());
}

export function createMainWindow(preload: string): BrowserWindow {
  const window = new BrowserWindow(buildWindowOptions(preload));

  window.once("ready-to-show", () => window.show());
  configureWebContentsSecurity(window.webContents);

  return window;
}
