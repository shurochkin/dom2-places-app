import { useEffect, useRef, useState } from "preact/hooks";
import {
  bindClosingConfirmation,
  bootstrapStore,
  currentView,
  inTelegramSignal,
  ready,
  visibleIndices,
} from "../lib/store";
import { initTelegram } from "../lib/telegram";
import { HeaderBar } from "./HeaderBar";
import { CityRow } from "./CityRow";
import { ShareDialog } from "./ShareDialog";
import { CompareDialog } from "./CompareDialog";
import { MapView } from "./MapView";
import { FriendsView } from "./FriendsView";

const ROW_HEIGHT = 56;
const OVERSCAN = 6;

export function CityList() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const isReady = ready.value;
  const indices = visibleIndices.value;
  const inTelegram = inTelegramSignal.value;
  const view = currentView.value;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const t = await initTelegram();
      if (cancelled) return;
      bindClosingConfirmation(t.setClosingConfirmation);
      await bootstrapStore();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // The scroller only exists after `ready` flips to true (before that we
    // render the splash). Re-run this effect once the DOM node appears so the
    // virtualizer learns the real viewport height; otherwise it stays at 0
    // and only OVERSCAN*2 rows are rendered.
    if (!isReady) return;
    const el = scrollerRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight);
    const ro = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [isReady]);

  if (!isReady) {
    return (
      <div class="splash" role="status">
        Загружаем список Лебедева…
      </div>
    );
  }

  const total = indices.length;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const end = Math.min(total, start + visibleCount);
  const slice: number[] = [];
  for (let i = start; i < end; i++) slice.push(indices[i]!);

  return (
    <div class="app">
      <HeaderBar
        onShare={() => setShareOpen(true)}
        onCompare={() => setCompareOpen(true)}
      />
      {shareOpen ? <ShareDialog onClose={() => setShareOpen(false)} /> : null}
      {compareOpen ? (
        <CompareDialog onClose={() => setCompareOpen(false)} />
      ) : null}
      {!inTelegram ? (
        <div class="banner">
          Вы открыли страницу вне Telegram — отметки сохраняются только в этом
          браузере. Откройте мини-приложение в Telegram, чтобы синхронизировать.
        </div>
      ) : null}
      <div
        ref={scrollerRef}
        class="scroller"
        style={view === "list" ? undefined : { display: "none" }}
        onScroll={(e) => setScrollTop((e.target as HTMLElement).scrollTop)}
      >
        {total === 0 ? (
          <div class="empty">Ничего не найдено</div>
        ) : (
          <div class="list" style={{ height: `${total * ROW_HEIGHT}px` }}>
            {slice.map((idx, i) => (
              <CityRow
                key={idx}
                idx={idx}
                style={{
                  position: "absolute",
                  top: `${(start + i) * ROW_HEIGHT}px`,
                  height: `${ROW_HEIGHT}px`,
                  left: 0,
                  right: 0,
                }}
              />
            ))}
          </div>
        )}
      </div>
      <div class="map-wrap" style={view === "map" ? undefined : { display: "none" }}>
        <MapView active={view === "map"} />
      </div>
      {view === "friends" ? (
        <FriendsView onAddFriend={() => setCompareOpen(true)} />
      ) : null}
    </div>
  );
}
