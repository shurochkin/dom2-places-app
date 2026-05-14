import { saveStatus, searchQuery, stats } from "../lib/store";

const STATUS_LABEL: Record<string, string> = {
  idle: "",
  saving: "сохраняем…",
  saved: "сохранено",
  error: "ошибка сохранения",
};

export function HeaderBar() {
  const s = stats.value;
  const status = saveStatus.value;
  return (
    <header class="header">
      <div class="header__top">
        <div class="header__counter">
          <strong>{s.visited}</strong>
          <span class="header__counter-sep">/</span>
          <span>{s.total}</span>
        </div>
        <div
          class="header__status"
          data-state={status}
          aria-live="polite"
        >
          {STATUS_LABEL[status]}
        </div>
      </div>
      <input
        type="search"
        class="header__search"
        placeholder="Поиск города"
        value={searchQuery.value}
        onInput={(e) => (searchQuery.value = (e.target as HTMLInputElement).value)}
        aria-label="Поиск города"
      />
    </header>
  );
}
