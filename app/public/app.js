const state = {
  draft: null,
  draftToken: null,
  lastSelectedCard: null,
  pending: false,
};

const els = {
  board: document.querySelector("#board"),
  roster: document.querySelector("#roster"),
  reveal: document.querySelector("#reveal"),
  result: document.querySelector("#result"),
  teamLabel: document.querySelector("#team-label"),
  pickLabel: document.querySelector("#pick-label"),
  lifelines: document.querySelector("#lifelines"),
  scoreChip: document.querySelector("#score-chip"),
  newGame: document.querySelector("#new-game"),
  draftError: document.querySelector("#draft-error"),
  playFriend: document.querySelector("#play-friend"),
  friendDialog: document.querySelector("#friend-dialog"),
  friendShare: document.querySelector("#friend-share"),
  activeFriendCode: document.querySelector("#active-friend-code"),
  copyInvite: document.querySelector("#copy-invite"),
  createFriendCode: document.querySelector("#create-friend-code"),
  joinFriend: document.querySelector("#join-friend"),
  friendCode: document.querySelector("#friend-code"),
  friendStatus: document.querySelector("#friend-status"),
  helpBtn: document.querySelector("#help-btn"),
  openRosterBtn: document.querySelector("#open-roster"),
  openWildBtn: document.querySelector("#open-wildcards"),
  rosterCount: document.querySelector("#roster-count"),
  wildCount: document.querySelector("#wild-count"),
  rosterPanel: document.querySelector(".roster-panel"),
  lifelineRow: document.querySelector(".lifeline-row"),
  backdrop: document.querySelector("#sheet-backdrop"),
  positionPicker: document.querySelector("#position-picker"),
  positionActions: document.querySelector("#position-picker .position-actions"),
};

// Mobile bottom-sheet controller. Roster + wild cards share one backdrop;
// only one sheet is open at a time. No-ops visually on desktop (sheets are
// reverted to inline by CSS), but state stays consistent.
let openSheetEl = null;

function openSheet(el) {
  if (!el) return;
  if (openSheetEl && openSheetEl !== el) openSheetEl.classList.remove("is-open");
  el.classList.add("is-open");
  els.backdrop.classList.add("is-visible");
  document.body.classList.add("sheet-locked");
  openSheetEl = el;
}

function closeSheet() {
  if (openSheetEl) openSheetEl.classList.remove("is-open");
  openSheetEl = null;
  els.backdrop.classList.remove("is-visible");
  document.body.classList.remove("sheet-locked");
  closePositionPicker();
}

// Wild cards: [type, short label, what it does]. Each is usable once per draft.
const LIFELINES = [
  ["same_team_shuffle", "Same team", "Reshuffle the current team's board into a fresh set of 10 cards from the same franchise."],
  ["different_team_shuffle", "New team", "Jump to a brand-new franchise's board — one you haven't been shown yet."],
  ["same_team_choose_position", "Pick position", "Reshuffle the current team's board to show only one position you choose (C, W, D or G), so you can target a slot you still need."],
  ["pick_two", "Pick 2", "Draft two players from the current board instead of one."],
  ["reveal_ratings", "Reveal ratings", "Reveal the hidden Point Share ratings on the current board so you can see the numbers before you pick."],
];

// Scoring bonuses, explained in plain language for the help panel.
const BONUSES = [
  ["Position fit", "Players score full value in their natural slot. A center playing wing scores 80%; a winger playing center scores 70%. Defense and goalies only ever play their own slot."],
  ["Handedness chemistry", "Fill a two-player slot with one left- and one right-hander to earn a bonus on your score: defense pair +2%, centers +1.5%, wings (one LW + one RW) +1.5%."],
];

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

function fmt(value) {
  if (value === null || value === undefined || value === "") return "-";
  return Number(value).toFixed(1);
}

function pct(value) {
  if (value === null || value === undefined || value === "") return "0%";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function ringMessage(rings) {
  if (rings >= 6) return "You matched Ken Dryden's record — a flawless build.";
  if (rings >= 4) return "A genuine contender, just short of the all-time mark.";
  if (rings >= 2) return "Some hardware on the shelf, but the dynasty slips away.";
  if (rings >= 1) return "One for the trophy case. Room to go bigger.";
  return "No cups this time. Run it back.";
}

function slotLabel(slot) {
  return {
    C: "Centers",
    W: "Wings",
    D: "Defense",
    G: "Goalie",
  }[slot];
}

function slotLimit(slot) {
  return { C: 2, W: 2, D: 2, G: 1 }[slot];
}

function fitLabel(card) {
  if (!card) return "";
  return card.positionFit?.key === "natural"
    ? card.naturalSlot
    : `${card.naturalSlot} -> ${card.assignedSlot}`;
}

function handLabel(card) {
  const hand = card?.shoots;
  if (hand === "L" || hand === "R") return hand;
  return "";
}

function initials(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "NHL";
}

function headshotUrl(card) {
  if (card.headshotUrl) return card.headshotUrl;
  return `/headshots/${card.playerId}.jpg`;
}

function teamLogoUrl(franchiseKey) {
  return `https://assets.nhle.com/logos/nhl/svg/${franchiseKey}_light.svg`;
}

function wireCardImages(cardElement) {
  const headshot = cardElement.querySelector(".headshot");
  const fallback = cardElement.querySelector(".headshot-fallback");
  const logo = cardElement.querySelector(".team-logo");
  if (headshot && fallback) {
    headshot.addEventListener("error", () => {
      headshot.hidden = true;
      fallback.classList.add("show");
    });
    if (headshot.complete && headshot.naturalWidth === 0) {
      headshot.hidden = true;
      fallback.classList.add("show");
    }
  }
  if (logo) {
    logo.addEventListener("error", () => {
      logo.hidden = true;
    });
  }
}

function boardRating(card) {
  if (card.rawCardPs === undefined) return "";
  if (card.positionGroup === "G") {
    return `
      <div class="card-rating">
        <span>Total ${fmt(card.rawCardPs)}</span>
        <span>GPS ${fmt(card.rawCardGps)}</span>
      </div>
    `;
  }
  return `
    <div class="card-rating">
      <span>Total ${fmt(card.rawCardPs)}</span>
      <span>OPS ${fmt(card.rawCardOps)}</span>
      <span>DPS ${fmt(card.rawCardDps)}</span>
    </div>
  `;
}

function renderBoard() {
  els.board.innerHTML = "";
  if (!state.draft || state.draft.status === "complete") return;

  for (const card of state.draft.board) {
    const button = document.createElement("button");
    button.className = "card";
    button.disabled = !card.selectable;
    const hand = handLabel(card);
    button.innerHTML = `
      <div class="card-visual">
        <img class="team-logo" src="${teamLogoUrl(card.franchiseKey)}" alt="" loading="lazy" />
        <div class="headshot-fallback">${initials(card.playerName)}</div>
        <img class="headshot" src="${headshotUrl(card)}" alt="${card.playerName}" loading="lazy" />
      </div>
      <div class="card-topline">
        <span class="badge badge-team">${card.franchiseKey}</span>
        <span class="badge">${card.position}</span>
        ${hand ? `<span class="badge badge-muted">${hand}</span>` : ""}
      </div>
      <p class="card-title">${card.playerName}</p>
      <div class="card-footerline">
        <span>${card.cardLabel}</span>
        <span>${card.cardType}</span>
      </div>
      ${boardRating(card)}
      ${card.selectable ? "" : `<p class="card-secret">${card.disabledReason.replace("_", " ")}</p>`}
    `;
    wireCardImages(button);
    button.addEventListener("click", () => selectCard(card.cardId).catch(showDraftError));
    els.board.appendChild(button);
  }
}

function renderRoster() {
  els.roster.innerHTML = "";
  const roster = state.draft?.roster || { C: [], W: [], D: [], G: [] };

  for (const slot of ["C", "W", "D", "G"]) {
    const group = document.createElement("section");
    group.className = "slot-group";
    group.innerHTML = `<h3>${slotLabel(slot)} ${roster[slot].length}/${slotLimit(slot)}</h3>`;
    for (let index = 0; index < slotLimit(slot); index += 1) {
      const card = roster[slot][index];
      const row = document.createElement("div");
      row.className = "slot";
      if (card) {
        const hand = handLabel(card);
        row.innerHTML = `
          <span>${card.playerName}<br><small>${card.franchiseKey} ${card.cardLabel} - ${fitLabel(card)}${hand ? ` - ${hand}` : ""}</small></span>
          <strong>${fmt(card.adjustedCardScore ?? card.rawCardPs)}</strong>
        `;
      } else {
        row.innerHTML = `<span>Open ${slot}</span><small>-</small>`;
      }
      group.appendChild(row);
    }
    els.roster.appendChild(group);
  }
}

function renderLifelines() {
  const lifelines = state.draft?.lifelines || {};
  els.lifelines.innerHTML = "";
  for (const [type, label] of LIFELINES) {
    const button = document.createElement("button");
    button.className = "life-button";
    button.disabled = state.draft?.status !== "drafting" || (lifelines[type] || 0) <= 0;
    button.textContent = `${label} (${lifelines[type] || 0})`;
    button.addEventListener("click", () => useLifeline(type).catch(showDraftError));
    els.lifelines.appendChild(button);
  }
}

function renderReveal() {
  const card = state.lastSelectedCard;
  if (!card) {
    els.reveal.classList.add("hidden");
    els.reveal.innerHTML = "";
    return;
  }
  const details = card.positionGroup === "G"
    ? `<p>Goalie impact: <strong>${fmt(card.rawCardGps)}</strong></p>`
    : `<p>Offense: <strong>${fmt(card.rawCardOps)}</strong> - Defense: <strong>${fmt(card.rawCardDps)}</strong></p>`;
  const fit = card.positionFit?.modifier < 1
    ? `<p>Position fit: <strong>${card.positionFit.label}</strong> (${pct(card.positionFit.modifier - 1)})</p>`
    : `<p>Position fit: <strong>Natural fit</strong></p>`;
  els.reveal.classList.remove("hidden");
  els.reveal.innerHTML = `
    <p class="eyebrow">Revealed pick</p>
    <h3>${card.playerName} - ${card.franchiseKey} ${card.cardLabel}</h3>
    ${handLabel(card) ? `<p>Shoots ${handLabel(card)}</p>` : ""}
    <p>Total impact: <strong>${fmt(card.rawCardPs)}</strong></p>
    ${fit}
    ${details}
  `;
}

function renderResult() {
  if (!state.draft || state.draft.status !== "complete") {
    els.result.classList.add("hidden");
    els.result.innerHTML = "";
    els.scoreChip.textContent = "Score hidden";
    return;
  }

  const compatibility = state.draft.compatibility;
  const positionRows = compatibility?.positionFits?.map((item) => `
    <div class="breakdown-row">
      <span>${item.playerName}<small>${item.naturalSlot === item.assignedSlot ? "Natural fit" : `Playing ${item.assignedSlot} (natural ${item.naturalSlot})`}</small></span>
      <strong>${fmt(item.adjustedScore)}</strong>
    </div>
  `).join("") || "";
  const bonusRows = compatibility?.handednessBonuses?.map((item) => `
    <div class="breakdown-row">
      <span>${item.label}<small>${item.hands.join(" / ") || "unknown"}</small></span>
      <strong>+${pct(item.bonusPct)}</strong>
    </div>
  `).join("") || "";

  els.scoreChip.textContent = `Final ${fmt(state.draft.finalScore)}`;
  els.result.classList.remove("hidden");
  els.result.innerHTML = `
    <p class="eyebrow">Result</p>
    <h2>${state.draft.rings} of 6 cups</h2>
    <p class="result-tagline">${ringMessage(state.draft.rings)}</p>
    ${state.draft.friendCode ? `
      <div class="friend-result">
        <button class="life-button" type="button" data-copy-result>Copy Result</button>
        <p class="draft-status" role="status"></p>
      </div>
    ` : ""}
    <div class="result-grid">
      <div class="result-box">
        <p class="eyebrow">Final score</p>
        <p class="result-value">${fmt(state.draft.finalScore)}</p>
        <small>out of 100</small>
      </div>
      <div class="result-box">
        <p class="eyebrow">Cups won</p>
        <p class="result-value">${state.draft.rings}</p>
        <small>of 6 possible</small>
      </div>
      <div class="result-box">
        <p class="eyebrow">Ranking</p>
        <p class="result-value">${state.draft.percentileBand}</p>
        <small>percentile</small>
      </div>
    </div>
    <div class="compatibility-board">
      <div>
        <p class="result-section-title">How the score adds up</p>
        <div class="breakdown-row">
          <span>Player talent<small>Total point shares</small></span>
          <strong>${fmt(state.draft.rawScore)}</strong>
        </div>
        <div class="breakdown-row">
          <span>After position fit<small>Out-of-position players score less</small></span>
          <strong>${fmt(state.draft.positionAdjustedScore)}</strong>
        </div>
        <div class="breakdown-row">
          <span>Chemistry bonus<small>Handedness pairings</small></span>
          <strong>+${pct(state.draft.compatibilityBonusPct)}</strong>
        </div>
        <div class="breakdown-row">
          <span>Final score</span>
          <strong>${fmt(state.draft.finalScore)}</strong>
        </div>
      </div>
      <div>
        <p class="result-section-title">Position fit</p>
        ${positionRows}
      </div>
      <div>
        <p class="result-section-title">Handedness chemistry</p>
        ${bonusRows}
      </div>
    </div>
  `;
}

function render() {
  if (!state.draft) return;
  els.teamLabel.textContent = state.draft.status === "complete"
    ? "Draft complete"
    : `${state.draft.currentFranchiseKey} board`;
  els.pickLabel.textContent = state.draft.status === "complete"
    ? "7 picks complete"
    : state.draft.pickTwoActive && state.draft.boardPicksRemaining > 1
      ? `Pick ${state.draft.pickNumber} of 7 - pick 2 active`
      : state.draft.pickTwoActive
        ? `Pick ${state.draft.pickNumber} of 7 - second pick same board`
    : `Pick ${state.draft.pickNumber} of 7`;
  renderBoard();
  renderRoster();
  renderLifelines();
  renderReveal();
  renderResult();
  renderMobileActions();
}

function renderMobileActions() {
  const roster = state.draft?.roster || { C: [], W: [], D: [], G: [] };
  const filled = ["C", "W", "D", "G"].reduce((total, slot) => total + roster[slot].length, 0);
  els.rosterCount.textContent = `${filled}/7`;
  const lifelines = state.draft?.lifelines || {};
  const wildLeft = LIFELINES.reduce((total, [type]) => total + (lifelines[type] || 0), 0);
  els.wildCount.textContent = String(wildLeft);
  els.openWildBtn.disabled = state.draft?.status !== "drafting" || wildLeft <= 0;
}

function showDraftError(error) {
  els.draftError.textContent = error.message;
  els.draftError.hidden = false;
}

async function updateDraft(action, body) {
  if (state.pending) return false;
  state.pending = true;
  els.draftError.hidden = true;
  try {
    const payload = await api(`/api/draft/${action}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    state.draftToken = payload.draftToken;
    state.draft = payload.draft;
    if (action === "start" || payload.selectedCard) {
      state.lastSelectedCard = payload.selectedCard || null;
    }
    closeSheet();
    render();
    return true;
  } finally {
    state.pending = false;
  }
}

function friendUrl(code) {
  const url = new URL(location.href);
  if (code) url.searchParams.set("friend", code);
  else url.searchParams.delete("friend");
  return url;
}

async function copyText(text, status, message) {
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = message;
  } catch {
    status.textContent = text;
  }
}

async function newGame(friendCode) {
  if (!await updateDraft("start", { friendCode })) return false;
  const code = state.draft.friendCode;
  els.friendShare.hidden = !code;
  els.activeFriendCode.value = code || "";
  els.playFriend.textContent = code ? `Friend draft · ${code}` : "Play a Friend";
  history.replaceState(null, "", friendUrl(code));
  return true;
}

async function startFriendDraft(code) {
  if (state.pending) return;
  els.friendStatus.textContent = "Starting draft…";
  try {
    if (await newGame(code)) {
      els.friendStatus.textContent = "";
      if (code === null) els.activeFriendCode.select();
      else els.friendDialog.close();
    }
  } catch (error) {
    els.friendStatus.textContent = error.message;
  }
}

async function selectCard(cardId) {
  await updateDraft("select", { draftToken: state.draftToken, cardId });
}

// Inline position picker shown *inside* the wild-card sheet (not a floating modal).
function openPositionPicker() {
  const roster = state.draft?.roster || { C: [], W: [], D: [], G: [] };
  els.positionActions.innerHTML = ["C", "W", "D", "G"].map((slot) => {
    const full = roster[slot].length >= slotLimit(slot);
    return `<button class="position-button" type="button" data-slot="${slot}"${full ? " disabled" : ""}>${slot}</button>`;
  }).join("");
  els.lifelines.style.display = "none";
  els.positionPicker.style.display = "grid";
}

function closePositionPicker() {
  els.positionPicker.style.display = "none";
  els.lifelines.style.display = "";
}

async function useLifeline(type, position = null) {
  if (type === "same_team_choose_position" && !position) {
    openPositionPicker();
    return;
  }
  await updateDraft("lifeline", { draftToken: state.draftToken, type, position });
}

function openHelp() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="help-card" role="dialog" aria-modal="true" aria-label="How to play">
      <div class="help-head">
        <h2>How it works</h2>
        <button class="help-close" type="button" aria-label="Close">&times;</button>
      </div>
      <div class="help-body">
        <p class="result-section-title">Wild cards</p>
        <p class="help-note">Each can be used once per draft.</p>
        <ul class="help-list">
          ${LIFELINES.map(([, label, desc]) => `
            <li><span class="help-term">${label}</span><span class="help-desc">${desc}</span></li>
          `).join("")}
        </ul>
        <p class="result-section-title">Score bonuses</p>
        <ul class="help-list">
          ${BONUSES.map(([term, desc]) => `
            <li><span class="help-term">${term}</span><span class="help-desc">${desc}</span></li>
          `).join("")}
        </ul>
      </div>
    </div>
  `;
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event) => {
    if (event.key === "Escape") close();
  };
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest(".help-close")) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
}

els.helpBtn.addEventListener("click", openHelp);
els.openRosterBtn.addEventListener("click", () => openSheet(els.rosterPanel));
els.openWildBtn.addEventListener("click", () => {
  closePositionPicker();
  openSheet(els.lifelineRow);
});
els.backdrop.addEventListener("click", closeSheet);
els.positionPicker.querySelector("[data-picker-back]").addEventListener("click", closePositionPicker);
els.positionActions.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-slot]");
  if (!button || button.disabled) return;
  await useLifeline("same_team_choose_position", button.dataset.slot).catch(showDraftError);
});
for (const button of document.querySelectorAll("[data-close-sheet]")) {
  button.addEventListener("click", closeSheet);
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSheet();
});
els.newGame.addEventListener("click", () => newGame().catch(showDraftError));
els.playFriend.addEventListener("click", () => {
  els.friendStatus.textContent = "";
  els.friendDialog.showModal();
});
els.createFriendCode.addEventListener("click", () => startFriendDraft(null));
els.joinFriend.addEventListener("submit", (event) => {
  event.preventDefault();
  startFriendDraft(els.friendCode.value);
});
els.copyInvite.addEventListener("click", () => {
  copyText(friendUrl(state.draft.friendCode).href, els.friendStatus, "Invite link copied.");
});
els.result.addEventListener("click", (event) => {
  const button = event.target.closest("[data-copy-result]");
  if (!button) return;
  const { friendCode, rings, finalScore } = state.draft;
  const result = `6 Cups NHL · ${friendCode} · ${rings}/6 Cups · Final score ${fmt(finalScore)}`;
  copyText(result, button.nextElementSibling, "Result copied.");
});

const inviteCode = new URLSearchParams(location.search).get("friend");
newGame(inviteCode ?? undefined).catch((error) => {
  els.teamLabel.textContent = "Failed to load";
  if (inviteCode === null) {
    showDraftError(error);
    return;
  }
  els.friendCode.value = inviteCode;
  els.friendStatus.textContent = error.message;
  if (!els.friendDialog.open) els.friendDialog.showModal();
});
