import {
  compareFilters,
  compareName,
  compareState,
  compareStats,
  currentView,
  exitCompareMode,
  saveStatus,
  searchQuery,
  stats,
  toggleBucketVisible,
  type CompareBucket,
} from "../lib/store";

const STATUS_LABEL: Record<string, string> = {
  idle: "",
  saving: "сохраняем…",
  saved: "сохранено",
  error: "ошибка сохранения",
};

function FilterChip({
  bucket,
  label,
  value,
}: { bucket: CompareBucket; label: string; value: number }) {
  const on = compareFilters.value.has(bucket);
  return (
    <button
      type="button"
      class={`chip chip--${bucket} chip--toggleable`}
      aria-pressed={on}
      data-on={on ? "1" : "0"}
      onClick={() => toggleBucketVisible(bucket)}
    >
      {label}: <strong>{value}</strong>
    </button>
  );
}

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
  const view = currentView.value;

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
      <div class="header__tabs" role="tablist">
        <button
          type="button"
          class="tab"
          data-active={view === "list" ? "1" : "0"}
          role="tab"
          aria-selected={view === "list"}
          onClick={() => (currentView.value = "list")}
        >
          Список
        </button>
        <button
          type="button"
          class="tab"
          data-active={view === "map" ? "1" : "0"}
          role="tab"
          aria-selected={view === "map"}
          onClick={() => (currentView.value = "map")}
        >
          Карта
        </button>
      </div>
      {view === "list" ? (
        <input
          type="search"
          class="header__search"
          placeholder="Поиск города"
          value={searchQuery.value}
          onInput={(e) => (searchQuery.value = (e.target as HTMLInputElement).value)}
          aria-label="Поиск города"
        />
      ) : null}
      {friend && cmp ? (
        <div class="header__compare">
          <div class="header__compare-title">
            Сравнение с {friendName ?? "другом"} ({cmp.friendTotal} / {s.total})
            {view === "map" ? (
              <span class="header__compare-hint"> · нажмите, чтобы скрыть на карте</span>
            ) : null}
          </div>
          <div class="header__compare-row">
            <FilterChip bucket="both" label="Общие" value={cmp.common} />
            <FilterChip bucket="mine" label="Только я" value={cmp.onlyMine} />
            <FilterChip bucket="friend" label="Только друг" value={cmp.onlyFriend} />
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
