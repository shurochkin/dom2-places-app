import { useEffect, useRef, useState } from "preact/hooks";
import { enterCompareMode } from "../lib/store";
import { readClipboard } from "../lib/telegram";
import { SHARE_PREFIX } from "../lib/encoding";

type Props = { onClose: () => void };

export function CompareDialog({ onClose }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [autoFilled, setAutoFilled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const text = await readClipboard();
      if (cancelled || !text) return;
      // Pull just our payload out of whatever the friend pasted — the share
      // message wraps the code in prose, so we extract starting at the prefix.
      const start = text.indexOf(SHARE_PREFIX);
      if (start < 0) return;
      const code = text.slice(start).trim().split(/\s/, 1)[0]!;
      setValue(code);
      setAutoFilled(true);
    })();
    taRef.current?.focus();
    return () => {
      cancelled = true;
    };
  }, []);

  function submit() {
    setError(null);
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Вставьте код, который прислал друг.");
      return;
    }
    const start = trimmed.indexOf(SHARE_PREFIX);
    const code = start >= 0 ? trimmed.slice(start).split(/\s/, 1)[0]! : trimmed;
    const result = enterCompareMode(code);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    onClose();
  }

  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <h2 class="modal__title">Сравнить со списком друга</h2>
        <p class="modal__hint">
          Вставьте код, который друг прислал в чате. Если он уже в буфере
          обмена — он подставится автоматически.
        </p>
        <textarea
          ref={taRef}
          rows={6}
          value={value}
          onInput={(e) => {
            setValue((e.target as HTMLTextAreaElement).value);
            setError(null);
          }}
          placeholder={`${SHARE_PREFIX}…`}
        />
        {autoFilled ? (
          <div class="modal__notice">Код подхвачен из буфера обмена.</div>
        ) : null}
        {error ? <div class="modal__error">{error}</div> : null}
        <div class="modal__actions">
          <button type="button" class="btn btn--primary" onClick={submit}>
            Сравнить
          </button>
          <button type="button" class="btn btn--ghost" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
