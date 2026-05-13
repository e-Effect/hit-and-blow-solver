const digits = "0123456789";

const state = {
  length: 4,
  allowRepeats: false,
  universe: [],
  candidates: [],
  history: [],
  currentGuess: "",
  currentScore: null,
  rankings: [],
  approximate: false,
};

const exactScoreLimit = 8_000_000;
const approximateGuessLimit = 120;
const approximateCandidateLimit = 700;

const els = {
  nextGuess: document.querySelector("#nextGuess"),
  statusText: document.querySelector("#statusText"),
  hitValue: document.querySelector("#hitValue"),
  blowValue: document.querySelector("#blowValue"),
  hitButtons: document.querySelector("#hitButtons"),
  blowButtons: document.querySelector("#blowButtons"),
  resultForm: document.querySelector("#resultForm"),
  remainingCount: document.querySelector("#remainingCount"),
  turnCount: document.querySelector("#turnCount"),
  expectedCount: document.querySelector("#expectedCount"),
  historyList: document.querySelector("#historyList"),
  rankingList: document.querySelector("#rankingList"),
  candidateList: document.querySelector("#candidateList"),
  lengthSelect: document.querySelector("#lengthSelect"),
  repeatToggle: document.querySelector("#repeatToggle"),
  resetButton: document.querySelector("#resetButton"),
  newGameButton: document.querySelector("#newGameButton"),
  undoButton: document.querySelector("#undoButton"),
  toggleDetailsButton: document.querySelector("#toggleDetailsButton"),
  detailsBody: document.querySelector("#detailsBody"),
};

const selectedResult = {
  hit: 0,
  blow: 0,
};

function generateNumbers(length, allowRepeats) {
  const results = [];

  function walk(prefix) {
    if (prefix.length === length) {
      results.push(prefix);
      return;
    }

    for (const digit of digits) {
      if (!allowRepeats && prefix.includes(digit)) continue;
      walk(prefix + digit);
    }
  }

  walk("");
  return results;
}

function judge(answer, guess) {
  let hit = 0;
  const answerRest = [];
  const guessRest = [];

  for (let i = 0; i < answer.length; i += 1) {
    if (answer[i] === guess[i]) {
      hit += 1;
    } else {
      answerRest.push(answer[i]);
      guessRest.push(guess[i]);
    }
  }

  const counts = new Map();
  for (const digit of answerRest) {
    counts.set(digit, (counts.get(digit) || 0) + 1);
  }

  let blow = 0;
  for (const digit of guessRest) {
    const count = counts.get(digit) || 0;
    if (count > 0) {
      blow += 1;
      counts.set(digit, count - 1);
    }
  }

  return { hit, blow };
}

function resultKey(result) {
  return `${result.hit}-${result.blow}`;
}

function scoreGuess(guess, candidates, candidateSet = new Set(candidates)) {
  const buckets = new Map();

  for (const answer of candidates) {
    const key = resultKey(judge(answer, guess));
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }

  const sizes = [...buckets.values()];
  const total = candidates.length || 1;
  const expected = sizes.reduce((sum, size) => sum + size * size, 0) / total;
  const worst = Math.max(...sizes);
  const isCandidate = candidateSet.has(guess);

  return {
    guess,
    expected,
    worst,
    splitCount: buckets.size,
    isCandidate,
  };
}

function compareScores(a, b) {
  if (a.expected !== b.expected) return a.expected - b.expected;
  if (a.worst !== b.worst) return a.worst - b.worst;
  if (a.isCandidate !== b.isCandidate) return a.isCandidate ? -1 : 1;
  if (a.splitCount !== b.splitCount) return b.splitCount - a.splitCount;
  return a.guess.localeCompare(b.guess);
}

function randomInt(max) {
  if (max <= 0) return 0;
  if (window.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    window.crypto.getRandomValues(values);
    return values[0] % max;
  }
  return Math.floor(Math.random() * max);
}

function pickRandom(items) {
  return items[randomInt(items.length)];
}

function shuffled(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sampleItems(items, limit) {
  if (items.length <= limit) return [...items];
  return shuffled(items).slice(0, limit);
}

function findBestGuess() {
  state.approximate = false;

  if (state.candidates.length === 0) {
    state.currentGuess = "";
    state.currentScore = null;
    state.rankings = [];
    return;
  }

  if (state.candidates.length === 1) {
    const only = state.candidates[0];
    state.currentGuess = only;
    state.currentScore = {
      guess: only,
      expected: 1,
      worst: 1,
      splitCount: 1,
      isCandidate: true,
    };
    state.rankings = [state.currentScore];
    return;
  }

  const searchCost = state.universe.length * state.candidates.length;
  if (state.history.length === 0 || searchCost > exactScoreLimit) {
    state.approximate = true;
    const approximateScores = scoreApproximateGuesses();
    state.rankings = approximateScores.slice(0, 8);
    state.currentScore = null;
    state.currentGuess = state.rankings[0]?.guess || pickFastGuess();
    return;
  }

  const candidateSet = new Set(state.candidates);
  const scores = state.universe.map((guess) => scoreGuess(guess, state.candidates, candidateSet));
  scores.sort(compareScores);
  state.rankings = pickFromEquivalentTop(scores).concat(scores).filter(uniqueScore).slice(0, 8);
  state.currentScore = state.rankings[0];
  state.currentGuess = state.currentScore.guess;
}

function uniqueScore(score, index, scores) {
  return scores.findIndex((item) => item.guess === score.guess) === index;
}

function pickFromEquivalentTop(scores) {
  const best = scores[0];
  if (!best) return [];
  const equivalent = scores.filter(
    (score) =>
      Math.abs(score.expected - best.expected) < 0.000001 &&
      score.worst === best.worst &&
      score.isCandidate === best.isCandidate &&
      score.splitCount === best.splitCount,
  );
  return [pickRandom(equivalent)];
}

function scoreApproximateGuesses() {
  const candidateSet = new Set(state.candidates);
  const candidateGuesses = sampleItems(state.candidates, Math.ceil(approximateGuessLimit * 0.65));
  const outsideGuesses = sampleItems(
    state.universe.filter((guess) => !candidateSet.has(guess)),
    approximateGuessLimit - candidateGuesses.length,
  );
  let guesses = [...candidateGuesses, ...outsideGuesses];

  if (state.history.length === 0) {
    guesses = sampleItems(state.universe, approximateGuessLimit);
  }

  const sampledCandidates = sampleItems(state.candidates, approximateCandidateLimit);
  const scores = guesses.map((guess) => scoreGuess(guess, sampledCandidates, candidateSet));
  scores.sort(compareScores);
  return pickFromEquivalentTop(scores).concat(scores).filter(uniqueScore);
}

function pickFastGuess() {
  const unused = state.universe.filter(
    (guess) => !state.history.some((item) => item.guess === guess),
  );
  const pool = unused.length ? unused : state.universe;
  return pickRandom(pool) || "";
}

function setStatus(message, isError = false) {
  els.statusText.textContent = message;
  els.statusText.classList.toggle("is-error", isError);
}

function render() {
  els.nextGuess.textContent = state.currentGuess || "----";
  els.remainingCount.textContent = state.candidates.length.toLocaleString("ja-JP");
  els.turnCount.textContent = state.history.length.toLocaleString("ja-JP");
  els.expectedCount.textContent = state.currentScore
    ? state.currentScore.expected.toFixed(1)
    : "-";

  renderResultButtons();

  els.historyList.innerHTML = "";
  for (const item of state.history) {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${item.guess}</strong><span>${item.hit}H ${item.blow}B</span>`;
    els.historyList.append(li);
  }
  if (state.history.length === 0) {
    const li = document.createElement("li");
    li.innerHTML = `<span>まだ履歴はありません</span>`;
    els.historyList.append(li);
  }

  els.rankingList.innerHTML = "";
  for (const score of state.rankings) {
    const row = document.createElement("div");
    row.className = "rank-row";
    row.innerHTML = `
      <strong>${score.guess}</strong>
      <span>期待 ${score.expected.toFixed(1)} / 最悪 ${score.worst} / 分岐 ${score.splitCount}${
        score.isCandidate ? " / 候補" : ""
      }</span>
    `;
    els.rankingList.append(row);
  }
  if (state.rankings.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "候補が減ると表示されます";
    els.rankingList.append(empty);
  }

  els.candidateList.innerHTML = "";
  const visibleCandidates = state.candidates.slice(0, 160);
  for (const candidate of visibleCandidates) {
    const item = document.createElement("span");
    item.textContent = candidate;
    els.candidateList.append(item);
  }
  if (state.candidates.length > visibleCandidates.length) {
    const item = document.createElement("span");
    item.textContent = `他 ${state.candidates.length - visibleCandidates.length}`;
    els.candidateList.append(item);
  }
  if (state.candidates.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "入力結果と一致する候補がありません";
    els.candidateList.append(empty);
  }
}

function renderResultButtons() {
  selectedResult.hit = Math.min(selectedResult.hit, state.length);
  selectedResult.blow = Math.min(selectedResult.blow, state.length);
  els.hitValue.textContent = selectedResult.hit;
  els.blowValue.textContent = selectedResult.blow;

  renderCountButtons(els.hitButtons, "hit", selectedResult.hit);
  renderCountButtons(els.blowButtons, "blow", selectedResult.blow);
}

function renderCountButtons(container, type, selectedValue) {
  container.innerHTML = "";
  for (let value = 0; value <= state.length; value += 1) {
    const button = document.createElement("button");
    button.className = "count-button";
    button.type = "button";
    button.textContent = value;
    button.dataset.type = type;
    button.dataset.value = String(value);

    const other = type === "hit" ? selectedResult.blow : selectedResult.hit;
    const impossible = value + other > state.length;
    button.disabled = impossible;
    button.classList.toggle("is-selected", value === selectedValue);
    button.setAttribute("aria-pressed", String(value === selectedValue));
    container.append(button);
  }
}

function recalculate(message = "") {
  findBestGuess();
  render();

  if (state.candidates.length === 0) {
    setStatus("結果が矛盾しています。履歴を戻して確認してください", true);
  } else if (state.candidates.length === 1) {
    setStatus(`答え候補は ${state.candidates[0]} です`);
  } else if (state.approximate) {
    setStatus(message || "軽く絞れる数字を選びました");
  } else if (message) {
    setStatus(message);
  } else {
    setStatus("この数字をコールしてください");
  }
}

function resetGame() {
  state.length = Number(els.lengthSelect.value);
  state.allowRepeats = els.repeatToggle.checked;
  state.universe = generateNumbers(state.length, state.allowRepeats);
  state.candidates = [...state.universe];
  state.history = [];
  selectedResult.hit = 0;
  selectedResult.blow = 0;
  recalculate("この数字をコールしてください");
}

function applyResult(event) {
  event.preventDefault();

  if (!state.currentGuess) {
    setStatus("先に設定を確認してください", true);
    return;
  }

  const hit = selectedResult.hit;
  const blow = selectedResult.blow;
  const isInteger = Number.isInteger(hit) && Number.isInteger(blow);

  if (!isInteger || hit < 0 || blow < 0 || hit + blow > state.length) {
    setStatus("ヒットとブローの合計を確認してください", true);
    return;
  }

  const guess = state.currentGuess;
  state.history.push({ guess, hit, blow });
  state.candidates = state.candidates.filter((candidate) => {
    const result = judge(candidate, guess);
    return result.hit === hit && result.blow === blow;
  });

  selectedResult.hit = 0;
  selectedResult.blow = 0;
  recalculate();
}

function undoLast() {
  state.history.pop();
  state.candidates = [...state.universe];
  for (const item of state.history) {
    state.candidates = state.candidates.filter((candidate) => {
      const result = judge(candidate, item.guess);
      return result.hit === item.hit && result.blow === item.blow;
    });
  }
  recalculate(state.history.length ? "1手戻しました" : "最初に戻しました");
}

els.resultForm.addEventListener("submit", applyResult);
els.resetButton.addEventListener("click", resetGame);
els.newGameButton.addEventListener("click", resetGame);
els.undoButton.addEventListener("click", undoLast);
els.hitButtons.addEventListener("click", handleCountButtonClick);
els.blowButtons.addEventListener("click", handleCountButtonClick);
els.toggleDetailsButton.addEventListener("click", () => {
  const shouldShow = els.detailsBody.hidden;
  els.detailsBody.hidden = !shouldShow;
  els.toggleDetailsButton.textContent = shouldShow ? "隠す" : "表示";
});

resetGame();

function handleCountButtonClick(event) {
  const button = event.target.closest(".count-button");
  if (!button || button.disabled) return;

  const value = Number(button.dataset.value);
  if (button.dataset.type === "hit") {
    selectedResult.hit = value;
    if (selectedResult.hit + selectedResult.blow > state.length) {
      selectedResult.blow = state.length - selectedResult.hit;
    }
  } else {
    selectedResult.blow = value;
    if (selectedResult.hit + selectedResult.blow > state.length) {
      selectedResult.hit = state.length - selectedResult.blow;
    }
  }

  renderResultButtons();
  setStatus(
    state.candidates.length === 1 ? `答え候補は ${state.candidates[0]} です` : "結果を選んで反映できます",
  );
}
