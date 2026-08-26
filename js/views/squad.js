import { el, empty, flag } from "../ui.js";
import { members, rosterOf, budgetLeft, spentBy, memberName } from "../league.js";

/** Le rose di tutti, con quanto ha speso ciascuno. */
export default function squadView(ctx) {
  const { league, catalog, uid } = ctx;
  if (!catalog) return el("div.card", "Carico il listone…");

  const ms = members(league);
  if (!ms.length) return empty("👥", "Nessun partecipante");

  return el("div.stack", { style: "gap:1.5rem" },
    ms.map((m) => {
      const rows = rosterOf(league, catalog, m.uid);
      const spent = spentBy(league, m.uid);
      const isMe = m.uid === uid;

      return el("section",
        el("div.section-head",
          el("h2", m.name, isMe && el("span.muted.small", { style: "font-weight:400" }, " · tu")),
          el("span.small.muted",
            `${rows.length}/${league.rosterSize} · `,
            el("span.mono", `${spent} spesi`), " · ",
            el("span.mono", `${budgetLeft(league, m.uid)} liberi`)),
        ),
        rows.length === 0
          ? el("div.card.card-tight.center.mute-2.small", "Rosa ancora vuota")
          : el("div.plist", rows.map(({ player: p, price }) => el("div.pcard",
              p.avatar
                ? el("img.pav", { src: p.avatar, alt: "", loading: "lazy" })
                : el("div.pav", { style: "display:grid;place-items:center" }, "♟"),
              el("div.pmain",
                el("div.pname",
                  p.title && el("span.title-tag", { class: p.title.toLowerCase() }, p.title),
                  el("span", p.name)),
                el("div.pmeta",
                  flag(p.country) && el("span", flag(p.country)),
                  el("span", `${p.rating} blitz`),
                  p.avgPoints ? el("span", `media ${p.avgPoints}/11`) : null),
              ),
              el("div.pright",
                el("div.pprice", price, el("span.small.mute-2", " cr")),
                p.price ? el("div.small.mute-2", `valore ${p.price}`) : null,
              ),
            ))),
      );
    }),
  );
}
