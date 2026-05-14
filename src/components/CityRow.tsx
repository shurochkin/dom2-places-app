import { useState } from "preact/hooks";
import {
  compareState,
  getCity,
  getCityYear,
  isCityVisited,
  isFriendVisited,
  toggleCity,
} from "../lib/store";
import { YearPicker } from "./YearPicker";

type Props = {
  idx: number;
  style: Record<string, string | number>;
};

export function CityRow({ idx, style }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const city = getCity(idx);
  const visited = isCityVisited(idx);
  const year = getCityYear(idx);
  const inCompare = compareState.value !== null;
  const friendHas = inCompare ? isFriendVisited(idx) : false;

  let badge: { label: string; cls: string } | null = null;
  if (inCompare) {
    if (visited && friendHas) badge = { label: "оба", cls: "chip--both" };
    else if (visited) badge = { label: "я", cls: "chip--mine" };
    else if (friendHas) badge = { label: "друг", cls: "chip--friend" };
  }

  return (
    <div
      class="row"
      style={style}
      data-visited={visited ? "1" : "0"}
      data-friend={friendHas ? "1" : "0"}
    >
      <label class="row__check">
        <input
          type="checkbox"
          checked={visited}
          onChange={() => toggleCity(idx)}
          aria-label={`Отметить ${city.name}`}
        />
        <span class="row__box" aria-hidden="true" />
      </label>
      <div class="row__main">
        <span class="row__rank">{city.rank}</span>
        <span class="row__name">{city.name}</span>
        {city.country ? <span class="row__country">{city.country}</span> : null}
        {badge ? <span class={`chip chip--sm ${badge.cls}`}>{badge.label}</span> : null}
      </div>
      <button
        type="button"
        class="row__year"
        onClick={() => setPickerOpen((v) => !v)}
        aria-label="Изменить год"
      >
        {year ?? "—"}
      </button>
      {pickerOpen ? (
        <YearPicker
          idx={idx}
          currentYear={year}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}
