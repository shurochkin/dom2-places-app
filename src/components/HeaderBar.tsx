import {
  compareName,
  compareState,
  compareStats,
  exitCompareMode,
  saveStatus,
  searchQuery,
  stats,
} from "../lib/store";

const STATUS_LABEL: Record<string, string> = {
  idle: "",
  saving: "сохраняем…",
  saved: "сохранено",
  error: "ошибка сохранения",
};

type Props = {
  onShare: () => void;
  onCompare: () => void;
};

export function HeaderBar({ onShare, onCompare }: Props) {
  const s = stats.value;
  const status = saveStatus.value;
  const friend = compareState.value;
  const friendName = compareName.value;
  const cmp = compareStats.value;

  return (
    <header class="header">
      <div class="header__top">
        <div class="header__counter">
          <strong>{s.visited}</strong>
          <span class="header__counter-sep">/</span>
          <span>{s.total}</span>
        </div>
        <div class="header__status" data-state={status} aria-live="polite">
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
      {friend && cmp ? (
        <div class="header__compare">
          <div class="header__compare-title">
            Сравнение с {friendName ?? "другом"} ({cmp.friendTotal} / {s.total})
          </div>
          <div class="header__compare-row">
            <span class="chip chip--both">
              Общие: <strong>{cmp.common}</strong>
            </span>
            <span class="chip chip--mine">
              Только я: <strong>{cmp.onlyMine}</strong>
            </span>
            <span class="chip chip--friend">
              Только друг: <strong>{cmp.onlyFriend}</strong>
            </span>
            <button
              type="button"
              class="btn btn--ghost btn--sm"
              onClick={exitCompareMode}
            >
              Выйти
            </button>
          </div>
        </div>
      ) : (
        <div class="header__actions">
          <button type="button" class="btn btn--sm" onClick={onShare}>
            Поделиться
          </button>
          <button type="button" class="btn btn--sm" onClick={onCompare}>
            Сравнить
          </button>
        </div>
      )}
    </header>
  );
}
