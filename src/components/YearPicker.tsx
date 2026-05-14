import { useEffect, useRef, useState } from "preact/hooks";
import { setCityYear } from "../lib/store";

type Props = {
  idx: number;
  currentYear: number | undefined;
  onClose: () => void;
};

const MIN_YEAR = 1900;
const MAX_YEAR = new Date().getFullYear();

export function YearPicker({ idx, currentYear, onClose }: Props) {
  const [value, setValue] = useState<string>(
    currentYear !== undefined ? String(currentYear) : "",
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function commit() {
    if (value === "") {
      setCityYear(idx, undefined);
      onClose();
      return;
    }
    const n = parseInt(value, 10);
    if (Number.isFinite(n) && n >= MIN_YEAR && n <= MAX_YEAR) {
      setCityYear(idx, n);
    }
    onClose();
  }

  return (
    <div class="year-picker" role="dialog" aria-label="Год посещения">
      <input
        ref={inputRef}
        type="number"
        inputMode="numeric"
        min={MIN_YEAR}
        max={MAX_YEAR}
        placeholder="год"
        value={value}
        onInput={(e) => setValue((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") onClose();
        }}
      />
      <button type="button" class="year-picker__ok" onClick={commit}>
        ОК
      </button>
      <button
        type="button"
        class="year-picker__clear"
        onClick={() => {
          setCityYear(idx, undefined);
          onClose();
        }}
      >
        Стереть
      </button>
    </div>
  );
}
