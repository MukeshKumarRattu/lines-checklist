// The daily report: one 24-hour window 07:00 → 07:00, split into the day shift
// (07:00–19:00) and night shift (19:00–07:00). Rendered as email-safe HTML
// (inline styles, tables); the Daily report tab shows this same HTML, so the
// screen, the printout and the email are always identical.
// Layout (kept deliberately simple): headline numbers → fake logs → one card per
// problem found (photo + status) → still open from earlier → fixed → checks done.
// Shift hours must match src/lib/followups.ts (SHIFT_START_HOURS).

const SHIFT_START = { day: 7, night: 19 };
const CHECKS_PER_SHIFT = 2;
const WALK_LINES_PER_SHIFT = 2;
const FINDING_LABEL = { fail: "Issue", X: "Broken", R: "Not installed properly", M: "Missing" };
const SHIFTS = ["day", "night"];
const SHIFT_NAME = { day: "Day", night: "Night" };
const MAX_EMAIL_IMAGES = 30;

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const hm = (t) => (t ? new Date(t).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", hour12: false }) : "");
const dmy = (t) => (t ? new Date(t).toLocaleDateString("en-CA", { month: "short", day: "numeric" }) : "");

export const shiftRange = (day, shift) => {
  const start = new Date(`${day}T00:00`);
  start.setHours(shift === "day" ? SHIFT_START.day : SHIFT_START.night, 0, 0, 0);
  const end = new Date(start);
  end.setHours(end.getHours() + 12);
  return { start: start.getTime(), end: end.getTime() };
};
/** The 24-hour report window of `day`: <day> 07:00 → next day 07:00. */
export const dayRange = (day) => ({ start: shiftRange(day, "day").start, end: shiftRange(day, "night").end });

/** The shift containing time t. Hours before 07:00 belong to the previous day's night. */
export const shiftOf = (t) => {
  const d = new Date(t);
  const h = d.getHours();
  const base = new Date(d);
  if (h < SHIFT_START.day) base.setDate(base.getDate() - 1);
  const shift = h >= SHIFT_START.day && h < SHIFT_START.night ? "day" : "night";
  const day = ymd(base);
  return { day, shift, key: `${day}|${shift}` };
};

/** The report day whose 07:00 → 07:00 window ended most recently before t. */
export const previousReportDay = (t) => shiftOf(t - 24 * 60 * 60 * 1000).day;

const subTime = (s) => (s.submittedAt ? Date.parse(s.submittedAt) : Date.parse(`${s.date}T${s.time || "00:00"}`));

// The submission comment carries the follow-up answers too; the status chips
// show those, so keep only what a person wrote.
const cleanNote = (comment) =>
  String(comment || "")
    .split(" · ")
    .filter((p) => !/^(Fixed:|Corrected now:|Needs new guard:|Sent to maintenance)/.test(p))
    .map((p) => p.replace(/^Attempted resolutions \/ by whom:/, "Tried:"))
    .join(" · ");

/**
 * @param img  (url) => src for an <img>. On the page the photo URL is used as-is;
 *             for email index.js swaps it for an embedded cid: attachment.
 */
export function buildDailyReport({ day, lines, submissions, tickets, investigations, now = Date.now(), img = (u) => u }) {
  const { start, end } = dayRange(day);
  const inDay = (t) => {
    if (!t) return false;
    const ms = typeof t === "number" ? t : Date.parse(t);
    return ms >= start && ms < end;
  };
  const shiftOfT = (t) => shiftOf(typeof t === "number" ? t : Date.parse(t)).shift;
  const started = { day: shiftRange(day, "day").start <= now, night: shiftRange(day, "night").start <= now };
  const finished = { day: shiftRange(day, "day").end <= now, night: shiftRange(day, "night").end <= now };
  const lineName = (id) => lines.find((l) => l.id === id)?.name ?? `Line ${id}`;
  const S = submissions.filter((s) => inDay(subTime(s)));
  const bySh = (list, sh) => list.filter((s) => shiftOfT(subTime(s)) === sh);

  // --- problems found today, each tied to what happened next --------------------------
  const problems = [];
  for (const s of S) {
    const kind = s.kind || "line";
    for (const it of s.items || []) {
      if (!FINDING_LABEL[it.status]) continue;
      const rawId = kind === "supervisor" ? String(it.id).split(":").slice(1).join(":") : String(it.id);
      const lineId = kind === "supervisor" ? String(it.id).split(":")[0] : String(s.line);
      const isWater = rawId === "water-on-floor";
      const guard = kind === "supervisor" ? String(it.text).replace(/^.*? · /, "") : it.text;
      const mine = (r) => r.submissionId === s.id && String(r.line) === lineId && (isWater ? r.issue === "Water on floor" : r.itemId === rawId);
      const tix = tickets.filter(mine);
      const inv = investigations.filter((r) => r.submissionId === s.id && r.itemId === rawId && String(r.line) === lineId);
      const chips = [];
      for (const t of tix)
        chips.push(t.status === "closed" ? ["green", `Fixed by ${t.closedBy}`] : ["amber", "Sent to maintenance"]);
      for (const i of inv)
        chips.push(
          i.status === "closed"
            ? ["slate", "Investigated"]
            : ["red", i.type === "fake-log" ? "Possible fake log" : "Not corrected — investigation"]
        );
      if (/Corrected now: Yes/.test(it.comment ?? "") || (isWater && /Fixed: Yes/.test(it.comment ?? "")))
        chips.push(["green", "Fixed on the spot"]);
      if (!chips.length) chips.push(["slate", kind === "line" && !isWater ? "Issue noted" : "Reported"]);
      problems.push({
        at: subTime(s),
        lineName: lineName(lineId),
        title: isWater ? "Water on floor" : `${FINDING_LABEL[it.status]}: ${guard}`,
        who: s.operator,
        role: kind === "supervisor" ? "supervisor" : "operator",
        note: cleanNote(it.comment),
        photo: it.photoUrl || tix.find((t) => t.photoUrl)?.photoUrl || inv.find((i) => i.photoUrl)?.photoUrl,
        chips,
        open: chips.some(([c]) => c === "amber" || c === "red"),
      });
    }
  }
  problems.sort((a, b) => Number(b.open) - Number(a.open) || a.at - b.at);

  const fakeLogs = investigations.filter((i) => i.type === "fake-log" && inDay(i.createdAt));
  const olderOpen = [
    ...tickets
      .filter((t) => t.status === "open" && Date.parse(t.createdAt) < start)
      .map((t) => ({ at: Date.parse(t.createdAt), lineName: t.lineName, title: `${t.issue}${t.location ? `: ${t.location}` : ""}`, tag: "Maintenance", photo: t.photoUrl, who: t.operator })),
    ...investigations
      .filter((i) => i.status === "open" && Date.parse(i.createdAt) < start)
      .map((i) => ({
        at: Date.parse(i.createdAt),
        lineName: i.lineName,
        title: `${i.finding}: ${i.location}`,
        tag: i.type === "fake-log" ? "Fake log" : "Investigation",
        photo: i.photoUrl,
        who: i.foundBy,
      })),
  ].sort((a, b) => a.at - b.at);
  // Things raised on earlier days that got fixed today.
  const fixedOlder = [
    ...tickets
      .filter((t) => t.status === "closed" && inDay(t.closedAt) && !inDay(t.createdAt))
      .map((t) => ({ at: Date.parse(t.closedAt), text: `${t.lineName} · ${t.issue}${t.location ? `: ${t.location}` : ""}`, by: t.closedBy })),
    ...investigations
      .filter((i) => i.status === "closed" && inDay(i.closedAt) && !inDay(i.createdAt))
      .map((i) => ({ at: Date.parse(i.closedAt), text: `${i.lineName} · investigation: ${i.location}`, by: i.closedBy })),
  ];

  // --- checks done (only lines that were checked) ---------------------------------------
  const coverage = lines
    .filter((l) => l.available !== false)
    .map((l) => {
      const of = (k) => S.filter((s) => (s.kind || "line") === k && String(s.line) === l.id);
      return {
        l,
        hasLine: (l.data?.items?.length ?? 0) > 0,
        line: of("line"),
        safety: of("safety"),
        walks: S.filter((s) => s.kind === "supervisor" && String(s.line).split(",").includes(l.id)),
      };
    })
    .filter((c) => c.line.length + c.safety.length + c.walks.length > 0);
  const walked = Object.fromEntries(
    SHIFTS.map((sh) => [sh, new Set(bySh(S.filter((s) => s.kind === "supervisor"), sh).flatMap((s) => String(s.line).split(",")))])
  );
  const missingChecks = coverage.reduce((n, c) => {
    for (const sh of SHIFTS) {
      if (!finished[sh]) continue;
      if (c.hasLine) n += Math.max(0, CHECKS_PER_SHIFT - bySh(c.line, sh).length);
      n += Math.max(0, CHECKS_PER_SHIFT - bySh(c.safety, sh).length);
    }
    return n;
  }, 0);
  const walksMissed = SHIFTS.filter((sh) => finished[sh] && walked[sh].size < WALK_LINES_PER_SHIFT);

  const stillOpen = problems.filter((p) => p.open).length + olderOpen.length;
  const fixedCount = problems.filter((p) => p.chips.some(([c]) => c === "green")).length + fixedOlder.length;

  // --- HTML ---------------------------------------------------------------------------
  const F = "font-family:Arial,Helvetica,sans-serif;color:#0f172a";
  const COLORS = {
    green: "background:#dcfce7;color:#166534",
    amber: "background:#fef3c7;color:#92400e",
    red: "background:#fee2e2;color:#991b1b",
    slate: "background:#f1f5f9;color:#334155",
  };
  const chip = ([c, t]) =>
    `<span style="display:inline-block;margin:2px 4px 0 0;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:bold;${COLORS[c]}">${esc(t)}</span>`;
  const h2 = (t, n) =>
    `<div style="margin:22px 0 8px;font-size:15px;font-weight:bold">${esc(t)}${
      n !== undefined ? ` <span style="color:#64748b;font-weight:normal">(${n})</span>` : ""
    }</div>`;
  const photoCell = (url, size = 84) => {
    const src = url ? img(url) : null;
    // On the page the thumbnail opens the full photo; in email (cid:) there's no link.
    const image = src
      ? `<img src="${esc(src)}" width="${size}" height="${size}" alt="photo" style="display:block;width:${size}px;height:${size}px;object-fit:cover;border-radius:6px;border:1px solid #e2e8f0">`
      : "";
    return src
      ? `<td style="width:${size}px;padding:0 12px 0 0;vertical-align:top">${
          src === url ? `<a href="${esc(url)}" target="_blank">${image}</a>` : image
        }</td>`
      : `<td style="width:${size}px;padding:0 12px 0 0;vertical-align:top"><div style="width:${size}px;height:${size}px;border-radius:6px;background:#f8fafc;border:1px dashed #cbd5e1;color:#94a3b8;font-size:10px;text-align:center;line-height:${size}px">no photo</div></td>`;
  };
  const card = (inner, border = "#e2e8f0") =>
    `<table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 8px;border:1px solid ${border};border-radius:8px;${F}"><tr><td style="padding:10px">
      <table cellpadding="0" cellspacing="0" style="width:100%;${F}"><tr>${inner}</tr></table></td></tr></table>`;
  const big = (n, label, bad) =>
    `<td style="width:25%;padding:4px"><div style="border-radius:8px;padding:10px 4px;text-align:center;${
      bad ? "background:#fef2f2;border:1px solid #fecaca" : "background:#f8fafc;border:1px solid #e2e8f0"
    }"><div style="font-size:26px;font-weight:bold;${bad ? "color:#b91c1c" : ""}">${n}</div><div style="font-size:12px;color:#475569">${esc(
      label
    )}</div></div></td>`;

  const nextDay = new Date(`${day}T12:00`);
  nextDay.setDate(nextDay.getDate() + 1);
  const dateLabel = `${new Date(`${day}T12:00`).toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}`;
  const allGood = !problems.length && !olderOpen.length && !missingChecks && !walksMissed.length;
  const headline = allGood
    ? `<div style="padding:10px 12px;border-radius:8px;background:#dcfce7;color:#166534;font-weight:bold">✓ All clear — no problems, nothing open, no missed checks.</div>`
    : `<div style="padding:10px 12px;border-radius:8px;background:${stillOpen ? "#fef3c7;color:#92400e" : "#f1f5f9;color:#334155"};font-weight:bold">${
        stillOpen ? `${stillOpen} thing${stillOpen > 1 ? "s" : ""} still need${stillOpen > 1 ? "" : "s"} action.` : "Nothing left open."
      }${walksMissed.length ? ` Supervisor walk-round missed on the ${walksMissed.map((s) => SHIFT_NAME[s].toLowerCase()).join(" and ")} shift.` : ""}</div>`;

  const checkRow = (c) => {
    const part = (sh) => {
      if (!started[sh]) return `<span style="color:#94a3b8">—</span>`;
      const bit = (label, list, need) => {
        if (!need) return "";
        const n = bySh(list, sh).length;
        const bad = n < need && finished[sh];
        return `<span style="${bad ? "color:#b91c1c;font-weight:bold" : n >= need ? "color:#166534" : "color:#92400e"}">${label} ${n}/${need}</span>`;
      };
      const w = bySh(c.walks, sh).length ? ` · <span style="color:#166534">Walk-round ✓</span>` : "";
      return [bit("Checklist", c.line, c.hasLine ? CHECKS_PER_SHIFT : 0), bit("Guards", c.safety, CHECKS_PER_SHIFT)].filter(Boolean).join(" · ") + w;
    };
    return `<tr><td style="padding:6px 8px;border-top:1px solid #e2e8f0;font-weight:bold;white-space:nowrap">${esc(c.l.name)}</td>
      <td style="padding:6px 8px;border-top:1px solid #e2e8f0;font-size:12px">${part("day")}</td>
      <td style="padding:6px 8px;border-top:1px solid #e2e8f0;font-size:12px">${part("night")}</td></tr>`;
  };

  const html = `<div style="${F};font-size:13px;max-width:760px">
  <div style="font-size:20px;font-weight:bold">Daily Report</div>
  <div style="color:#475569;margin-bottom:12px">${esc(dateLabel)} · 07:00 → ${esc(
    nextDay.toLocaleDateString("en-CA", { month: "short", day: "numeric" })
  )} 07:00 · Day 07–19 · Night 19–07</div>
  ${headline}
  <table cellpadding="0" cellspacing="0" style="width:100%;margin-top:8px;${F}"><tr>
    ${big(problems.length, "Problems found", problems.length > 0)}
    ${big(stillOpen, "Still open", stillOpen > 0)}
    ${big(fixedCount, "Fixed", false)}
    ${big(missingChecks, "Missed checks", missingChecks > 0)}
  </tr></table>

  ${
    fakeLogs.length
      ? `<div style="margin-top:16px;padding:10px 12px;border:2px solid #dc2626;border-radius:8px;background:#fef2f2">
      <div style="font-weight:bold;color:#991b1b;margin-bottom:4px">⚠ Possible fake logs (${fakeLogs.length})</div>
      ${fakeLogs
        .map(
          (i) =>
            `<div style="margin-top:3px"><b>${esc(i.operator)}</b> ticked <b>${esc(i.location)}</b> (${esc(i.lineName)}) as Good at ${hm(
              i.operatorAt
            )} — supervisor ${esc(i.foundBy)} found it <b>${esc(i.finding)}</b> at ${hm(i.createdAt)}.</div>`
        )
        .join("")}</div>`
      : ""
  }

  ${h2("Problems found", problems.length)}
  ${
    problems.length
      ? problems
          .map((p) =>
            card(
              `${photoCell(p.photo)}<td style="vertical-align:top">
                <div style="font-size:14px;font-weight:bold">${esc(p.title)}</div>
                <div style="color:#475569;font-size:12px;margin-top:2px">${esc(p.lineName)} · ${SHIFT_NAME[shiftOfT(p.at)]} ${hm(p.at)} · ${esc(p.who)} (${p.role})</div>
                ${p.note ? `<div style="font-size:12px;margin-top:4px">${esc(p.note)}</div>` : ""}
                <div style="margin-top:4px">${p.chips.map(chip).join("")}</div></td>`,
              p.open ? "#fcd34d" : "#e2e8f0"
            )
          )
          .join("")
      : `<div style="color:#64748b">None today.</div>`
  }

  ${
    olderOpen.length
      ? h2("Still open from earlier days", olderOpen.length) +
        olderOpen
          .map((o) =>
            card(
              `${photoCell(o.photo, 56)}<td style="vertical-align:top"><div style="font-weight:bold">${esc(o.title)}</div>
              <div style="color:#475569;font-size:12px;margin-top:2px">${esc(o.lineName)} · raised ${dmy(o.at)} by ${esc(o.who)}</div>
              <div style="margin-top:4px">${chip([o.tag === "Maintenance" ? "amber" : "red", o.tag])}</div></td>`
            )
          )
          .join("")
      : ""
  }

  ${
    fixedOlder.length
      ? h2("Fixed today (from earlier days)", fixedOlder.length) +
        fixedOlder.map((f) => `<div style="margin:3px 0">✓ ${esc(f.text)} — <b>${esc(f.by)}</b> at ${hm(f.at)}</div>`).join("")
      : ""
  }

  ${h2("Checks done", coverage.length ? `${coverage.length} line${coverage.length > 1 ? "s" : ""}` : undefined)}
  ${
    coverage.length
      ? `<table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;${F}">
          <tr style="background:#f8fafc;font-size:12px;color:#475569"><td style="padding:6px 8px">Line</td><td style="padding:6px 8px">Day 07–19</td><td style="padding:6px 8px">Night 19–07</td></tr>
          ${coverage.map(checkRow).join("")}</table>
          <div style="font-size:11px;color:#64748b;margin-top:4px">Each line: checklist and guards 2× per shift. Supervisor walks ${WALK_LINES_PER_SHIFT} lines per shift.</div>`
      : `<div style="color:#64748b">No line was checked.</div>`
  }

  <table style="width:100%;margin-top:24px;border-top:1px solid #e2e8f0;${F};font-size:11px;color:#64748b"><tr>
    <td style="padding-top:8px">Reviewed by: ______________________</td>
    <td style="padding-top:8px;text-align:right">Signature: ______________________</td>
  </tr></table>
</div>`;

  const subject = `Daily report ${day}: ${
    allGood ? "all clear" : `${problems.length} problem${problems.length === 1 ? "" : "s"}, ${stillOpen} still open, ${fixedCount} fixed`
  }${missingChecks ? `, ${missingChecks} missed checks` : ""}${fakeLogs.length ? ` — ${fakeLogs.length} POSSIBLE FAKE LOG${fakeLogs.length > 1 ? "S" : ""}` : ""}`;
  return { subject, html };
}

export { MAX_EMAIL_IMAGES };
