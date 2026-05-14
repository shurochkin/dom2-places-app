const THEME_MAP: Record<string, string> = {
  bg_color: "--tg-bg",
  text_color: "--tg-text",
  hint_color: "--tg-hint",
  link_color: "--tg-link",
  button_color: "--tg-button",
  button_text_color: "--tg-button-text",
  secondary_bg_color: "--tg-secondary-bg",
  header_bg_color: "--tg-header-bg",
  accent_text_color: "--tg-accent",
  section_bg_color: "--tg-section-bg",
  section_header_text_color: "--tg-section-header",
  subtitle_text_color: "--tg-subtitle",
  destructive_text_color: "--tg-destructive",
};

function applyTheme(params: TelegramThemeParams) {
  const root = document.documentElement;
  for (const [key, cssVar] of Object.entries(THEME_MAP)) {
    const value = params[key as keyof TelegramThemeParams];
    if (value) root.style.setProperty(cssVar, value);
  }
}

function applyViewport(tg: TelegramWebApp) {
  document.documentElement.style.setProperty(
    "--tg-vsh",
    `${tg.viewportStableHeight}px`,
  );
}

export async function waitForTelegram(timeoutMs = 1500): Promise<TelegramWebApp | null> {
  if (typeof window === "undefined") return null;
  if (window.Telegram?.WebApp) return window.Telegram.WebApp;
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (window.Telegram?.WebApp) return resolve(window.Telegram.WebApp);
      if (Date.now() - start >= timeoutMs) return resolve(null);
      setTimeout(tick, 50);
    };
    tick();
  });
}

export type TelegramHandle = {
  tg: TelegramWebApp | null;
  inTelegram: boolean;
  setClosingConfirmation(enable: boolean): void;
};

export const BOT_USERNAME = "lebedev_places_bot";

export function getUserFirstName(): string | null {
  return globalThis.window?.Telegram?.WebApp?.initDataUnsafe?.user?.first_name ?? null;
}

export function shareViaTelegram(text: string): boolean {
  const tg = globalThis.window?.Telegram?.WebApp;
  const botUrl = `https://t.me/${BOT_USERNAME}`;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(botUrl)}&text=${encodeURIComponent(text)}`;
  if (tg && typeof (tg as unknown as { openTelegramLink?: (url: string) => void }).openTelegramLink === "function") {
    (tg as unknown as { openTelegramLink: (url: string) => void }).openTelegramLink(shareUrl);
    return true;
  }
  // Browser fallback — opens Telegram in a new tab if installed.
  if (typeof window !== "undefined") {
    window.open(shareUrl, "_blank", "noopener");
    return true;
  }
  return false;
}

export function readClipboard(): Promise<string | null> {
  const tg = globalThis.window?.Telegram?.WebApp as
    | (TelegramWebApp & {
        readTextFromClipboard?: (cb: (text: string) => void) => void;
      })
    | undefined;
  if (tg && typeof tg.readTextFromClipboard === "function") {
    return new Promise((resolve) => {
      // Telegram fires the callback with "" if the clipboard is empty or
      // permission was denied; treat both as "no data".
      try {
        tg.readTextFromClipboard!((text) => resolve(text || null));
      } catch {
        resolve(null);
      }
    });
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
    return navigator.clipboard.readText().then((t) => t || null).catch(() => null);
  }
  return Promise.resolve(null);
}

export async function writeClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export async function initTelegram(): Promise<TelegramHandle> {
  const tg = await waitForTelegram();
  // Empty initData means the SDK loaded as a regular script but the host is
  // not a real Telegram client — treat as outside Telegram.
  if (!tg || !tg.initData) {
    return {
      tg,
      inTelegram: false,
      setClosingConfirmation: () => {},
    };
  }

  try {
    tg.ready();
    tg.expand();
    applyTheme(tg.themeParams);
    applyViewport(tg);
    document.documentElement.dataset.theme = tg.colorScheme;

    tg.onEvent("themeChanged", () => {
      applyTheme(tg.themeParams);
      document.documentElement.dataset.theme = tg.colorScheme;
    });
    tg.onEvent("viewportChanged", () => applyViewport(tg));
  } catch (err) {
    console.warn("Telegram init failed", err);
  }

  return {
    tg,
    inTelegram: true,
    setClosingConfirmation: (enable) => {
      try {
        if (enable) tg.enableClosingConfirmation();
        else tg.disableClosingConfirmation();
      } catch {
        // Older Telegram clients may not support these calls.
      }
    },
  };
}
