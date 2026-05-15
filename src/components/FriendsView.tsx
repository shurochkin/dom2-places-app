import { useState } from "preact/hooks";
import {
  aggregate,
  enterCompareWithFriend,
  friends,
  removeFriend,
  stats,
} from "../lib/store";
import { friendVisitedCount } from "../lib/friends";

type Props = {
  onAddFriend: () => void;
};

function formatPercent(part: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function formatDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export function FriendsView({ onAddFriend }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const list = friends.value;
  const s = stats.value;
  const agg = aggregate.value;

  async function handleDelete(id: string) {
    if (!confirm("Удалить этого друга из списка?")) return;
    setBusyId(id);
    try {
      await removeFriend(id);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div class="friends">
      <div class="friends__aggregate">
        <div class="friends__agg-title">
          Совместная статистика ({list.length}
          {list.length === 1 ? " друг" : list.length > 1 && list.length < 5 ? " друга" : " друзей"})
        </div>
        <div class="friends__agg-grid">
          <div class="friends__agg-item">
            <span class="friends__agg-num">{agg.union}</span>
            <span class="friends__agg-lbl">вы + друзья</span>
            <span class="friends__agg-sub">{formatPercent(agg.union, s.total)}</span>
          </div>
          <div class="friends__agg-item">
            <span class="friends__agg-num">{agg.intersection}</span>
            <span class="friends__agg-lbl">общие со всеми</span>
            <span class="friends__agg-sub">{formatPercent(agg.intersection, s.total)}</span>
          </div>
          <div class="friends__agg-item">
            <span class="friends__agg-num">{agg.onlyMine}</span>
            <span class="friends__agg-lbl">только вы</span>
          </div>
          <div class="friends__agg-item">
            <span class="friends__agg-num">{agg.onlyFriends}</span>
            <span class="friends__agg-lbl">только друзья</span>
          </div>
        </div>
      </div>

      <div class="friends__list">
        {list.length === 0 ? (
          <div class="friends__empty">
            Пока никого не сохранено. Вставьте код друга — он появится здесь.
          </div>
        ) : (
          list.map((f) => {
            const visited = friendVisitedCount(f);
            return (
              <div class="friend" key={f.id}>
                <button
                  type="button"
                  class="friend__main"
                  onClick={() => enterCompareWithFriend(f.id)}
                  aria-label={`Сравнить с ${f.name || "другом"}`}
                >
                  <div class="friend__name">{f.name || "Без имени"}</div>
                  <div class="friend__meta">
                    <span>
                      {visited} / {s.total} ({formatPercent(visited, s.total)})
                    </span>
                    <span class="friend__date">· {formatDate(f.addedAt)}</span>
                  </div>
                </button>
                <button
                  type="button"
                  class="friend__delete"
                  onClick={() => handleDelete(f.id)}
                  disabled={busyId === f.id}
                  aria-label={`Удалить ${f.name || "друга"}`}
                  title="Удалить"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 6h18" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            );
          })
        )}
      </div>

      <div class="friends__footer">
        <button type="button" class="btn btn--primary" onClick={onAddFriend}>
          Добавить друга
        </button>
      </div>
    </div>
  );
}
