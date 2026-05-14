/// <reference types="astro/client" />

interface TelegramThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  header_bg_color?: string;
  accent_text_color?: string;
  section_bg_color?: string;
  section_header_text_color?: string;
  subtitle_text_color?: string;
  destructive_text_color?: string;
}

interface TelegramCloudStorage {
  setItem(
    key: string,
    value: string,
    callback?: (err: Error | null, success?: boolean) => void,
  ): void;
  getItem(
    key: string,
    callback: (err: Error | null, value?: string) => void,
  ): void;
  getItems(
    keys: string[],
    callback: (err: Error | null, values?: Record<string, string>) => void,
  ): void;
  removeItem(
    key: string,
    callback?: (err: Error | null, success?: boolean) => void,
  ): void;
  removeItems(
    keys: string[],
    callback?: (err: Error | null, success?: boolean) => void,
  ): void;
  getKeys(callback: (err: Error | null, keys?: string[]) => void): void;
}

interface TelegramWebApp {
  ready(): void;
  expand(): void;
  close(): void;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  colorScheme: "light" | "dark";
  themeParams: TelegramThemeParams;
  initData: string;
  initDataUnsafe?: { user?: { id: number; first_name?: string } };
  CloudStorage?: TelegramCloudStorage;
  MainButton: {
    setText(text: string): void;
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
  };
  BackButton: { show(): void; hide(): void };
  enableClosingConfirmation(): void;
  disableClosingConfirmation(): void;
  onEvent(event: string, cb: (...args: unknown[]) => void): void;
  offEvent(event: string, cb: (...args: unknown[]) => void): void;
}

interface Window {
  Telegram?: { WebApp?: TelegramWebApp };
}
