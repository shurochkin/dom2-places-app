import { useEffect, useRef, useState } from "preact/hooks";
import { buildShareCode, stats } from "../lib/store";
import {
  BOT_USERNAME,
  getUserFirstName,
  shareViaTelegram,
  writeClipboard,
} from "../lib/telegram";

type Props = { onClose: () => void };

export function ShareDialog({ onClose }: Props) {
  const s = stats.value;
  const [name, setName] = useState<string>(() => getUserFirstName() ?? "");
  const [copied, setCopied] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const code = buildShareCode(name.trim() || null);
  const message =
    `Я отметил ${s.visited} из ${s.total} мест. ` +
    `Сравним?\n\nОткрой @${BOT_USERNAME}, нажми «Сравнить» — код подхватится автоматически.\n\n${code}`;

  useEffect(() => {
    taRef.current?.focus();
    taRef.current?.select();
  }, []);

  async function copy() {
    const ok = await writeClipboard(message);
    if (!ok && taRef.current) {
      taRef.current.select();
      try {
        document.execCommand("copy");
      } catch {
        /* ignore */
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function share() {
    shareViaTelegram(message);
    onClose();
  }

  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <h2 class="modal__title">Поделиться списком</h2>
        <label class="modal__label">
          Ваше имя (увидит друг)
          <input
            type="text"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            placeholder="Имя"
            maxLength={32}
          />
        </label>
        <label class="modal__label">
          Сообщение
          <textarea ref={taRef} readOnly rows={6} value={message} />
        </label>
        <div class="modal__actions">
          <button type="button" class="btn btn--primary" onClick={share}>
            Открыть Telegram
          </button>
          <button type="button" class="btn" onClick={copy}>
            {copied ? "Скопировано" : "Скопировать"}
          </button>
          <button type="button" class="btn btn--ghost" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <p class="modal__hint">
          Друг откроет бота, тапнет «Сравнить» — приложение само заберёт код из
          буфера обмена.
        </p>
      </div>
    </div>
  );
}
