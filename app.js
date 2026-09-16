// «Орбита» в браузере: та же колода и то же расписание повторений, что и в приложении на Маке.
// Прогресс хранится в самом телефоне (localStorage), интернет нужен только при первом открытии.

const STORAGE_KEY = "orbita.web.v1";

// ------------------------------ Мелкие помощники ------------------------------

const $ = (html) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = html.trim();
    return wrap.firstElementChild;
};

const esc = (text) => String(text).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

/// Формула мини-LaTeX → HTML. Кириллица внутри формул (единицы вроде м/с²) идёт как текст.
function math(latex, display = false) {
    if (!window.katex) return esc(latex);
    try {
        return katex.renderToString(latex, { throwOnError: false, strict: "ignore", displayMode: display });
    } catch {
        return esc(latex);
    }
}

const choiceHTML = (choice) => (choice.formula ? math(choice.formula) : esc(choice.text));

const plural = (n, one, few, many) => {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
};

const cardsWord = (n) => plural(n, "карточка", "карточки", "карточек");
const daysWord = (n) => plural(n, "день", "дня", "дней");

function haptic(ms = 12) {
    if (navigator.vibrate) navigator.vibrate(ms);
}

// ------------------------------ Расписание повторений ------------------------------
// Порт Scheduler.swift: шаги заучивания, затем интервалы, растущие с «лёгкостью» карточки.

const Scheduler = {
    learningSteps: [60, 10 * 60],
    relearningSteps: [10 * 60],
    startingEase: 2.5,
    minimumEase: 1.3,
    graduatingInterval: 1,
    easyInterval: 4,
    maximumInterval: 36500,
    dayStartHour: 4,

    dayStart(date) {
        const shifted = new Date(date.getTime() - this.dayStartHour * 3600e3);
        const midnight = new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate());
        midnight.setHours(this.dayStartHour);
        return midnight;
    },

    dayKey(date) {
        const day = this.dayStart(date);
        const pad = (n) => String(n).padStart(2, "0");
        return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
    },

    next(state, rating, now) {
        const s = state
            ? { ...state }
            : { due: now.getTime(), interval: 0, ease: this.startingEase, reps: 0, lapses: 0, step: 0, relearning: false, last: null };
        s.reps += 1;
        s.last = now.getTime();

        if (s.step !== null && s.step !== undefined) {
            const steps = s.relearning ? this.relearningSteps : this.learningSteps;
            if (rating === 1) {
                s.step = 0;
                s.due = now.getTime() + steps[0] * 1000;
            } else if (rating === 2) {
                const delay = s.step === 0 && steps.length > 1 ? (steps[0] + steps[1]) / 2 : steps[Math.min(s.step, steps.length - 1)];
                s.due = now.getTime() + delay * 1000;
            } else if (rating === 3) {
                if (s.step + 1 < steps.length) {
                    s.step += 1;
                    s.due = now.getTime() + steps[s.step] * 1000;
                } else {
                    this.graduate(s, s.relearning ? Math.max(1, s.interval) : this.graduatingInterval, now);
                }
            } else {
                this.graduate(s, s.relearning ? Math.max(1, s.interval) + 1 : this.easyInterval, now);
            }
            return s;
        }

        if (rating === 1) {
            s.lapses += 1;
            s.ease = Math.max(this.minimumEase, s.ease - 0.2);
            s.interval = Math.max(1, Math.round(s.interval * 0.5));
            s.step = 0;
            s.relearning = true;
            s.due = now.getTime() + this.relearningSteps[0] * 1000;
        } else if (rating === 2) {
            s.ease = Math.max(this.minimumEase, s.ease - 0.15);
            this.schedule(s, Math.max(s.interval + 1, s.interval * 1.2), now);
        } else if (rating === 3) {
            this.schedule(s, Math.max(s.interval + 1, s.interval * s.ease), now);
        } else {
            this.schedule(s, Math.max(s.interval + 1, s.interval * s.ease * 1.3), now);
            s.ease += 0.15;
        }
        return s;
    },

    graduate(s, interval, now) {
        s.step = null;
        s.relearning = false;
        this.schedule(s, interval, now);
    },

    schedule(s, interval, now) {
        s.interval = Math.min(this.maximumInterval, Math.max(1, Math.round(interval)));
        // Повторения назначаются на начало учебного дня — как в приложении на Маке.
        const day = this.dayStart(now);
        s.due = day.getTime() + s.interval * 86400e3;
    },

    preview(state, rating, now) {
        const next = this.next(state, rating, now);
        if (next.step !== null && next.step !== undefined) {
            return this.formatSeconds((next.due - now.getTime()) / 1000);
        }
        return this.formatDays(next.interval);
    },

    formatSeconds(seconds) {
        const minutes = Math.max(1, Math.round(seconds / 60));
        if (minutes < 60) return `${minutes} мин`;
        return `${Math.round(minutes / 60)} ч`;
    },

    formatDays(days) {
        if (days < 30) return `${Math.round(days)} д`;
        if (days < 365) return `${Math.round(days / 30)} мес`;
        return `${(days / 365).toFixed(1)} г`;
    },

    rank(state) {
        if (!state || state.step !== null) return "dust";
        if (state.interval < 1) return "dust";
        if (state.interval < 7) return "moon";
        if (state.interval < 21) return "planet";
        return "star";
    },
};

const RANK_TITLE = { dust: "Пыль", moon: "Луна", planet: "Планета", star: "Звезда" };
const RANK_ICON = { dust: "·:", moon: "☾", planet: "🪐", star: "✦" };
const KIND_TITLE = { formula: "Формулы", question: "Вопросы", problem: "Задачи" };
const KIND_LABEL = { formula: "ВЫБЕРИ ФОРМУЛУ", question: "ВОПРОС", problem: "МИНИ-ЗАДАЧА" };

/// «ВЫБЕРИ ФОРМУЛУ» — только когда варианты и правда формулы.
const frontLabel = (card) =>
    card.kind === "formula" && card.choices[0] && !card.choices[0].formula ? "ВЫБЕРИ ОТВЕТ" : KIND_LABEL[card.kind];
const RATING_TITLE = { 1: "Снова", 2: "Трудно", 3: "Хорошо", 4: "Легко" };
const RATING_CLASS = { 1: "again", 2: "hard", 3: "good", 4: "easy" };
const RATING_COLOR = { 1: "#FF8FA0", 2: "#FFC38A", 3: "#86E6FF", 4: "#9CF2CB" };

// ------------------------------ Хранилище ------------------------------

const Store = {
    deck: { decks: [], cards: [] },
    data: { reviews: {}, log: {}, introduced: {}, filter: null, newPerDay: 10 },

    async load() {
        this.deck = await fetch("deck.json").then((r) => r.json());
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                this.data = { ...this.data, ...JSON.parse(saved) };
            } catch {}
        }
        if (!this.data.filter) {
            this.data.filter = { decks: this.deck.decks.map((d) => d.id), kinds: ["formula", "question", "problem"] };
        }
        // Карточек, которых больше нет в колоде, в прогрессе быть не должно.
        const ids = new Set(this.deck.cards.map((c) => c.id));
        for (const id of Object.keys(this.data.reviews)) if (!ids.has(id)) delete this.data.reviews[id];
    },

    save() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    },

    card(id) {
        return this.deck.cards.find((c) => c.id === id);
    },

    deckOf(card) {
        return this.deck.decks.find((d) => d.id === card.deck);
    },

    state(card) {
        return this.data.reviews[card.id] || null;
    },

    get activeCards() {
        const { decks, kinds } = this.data.filter;
        return this.deck.cards.filter((c) => decks.includes(c.deck) && kinds.includes(c.kind));
    },

    dueCards(now, learnAhead = 0) {
        return this.activeCards
            .map((card) => [card, this.data.reviews[card.id]])
            .filter(([, s]) => s && (s.due <= now.getTime() || (s.step !== null && s.due <= now.getTime() + learnAhead)))
            .sort((a, b) => a[1].due - b[1].due)
            .map(([card]) => card);
    },

    newCards() {
        const fresh = this.activeCards.filter((c) => !this.data.reviews[c.id]);
        const byDeck = this.deck.decks.map((deck) =>
            interleave(["formula", "question", "problem"].map((kind) => fresh.filter((c) => c.deck === deck.id && c.kind === kind)))
        );
        return interleave(byDeck);
    },

    newRemaining(now) {
        const used = this.data.introduced[Scheduler.dayKey(now)] || 0;
        return Math.max(0, Math.min(this.data.newPerDay - used, this.newCards().length));
    },

    dueCount(now) {
        return this.dueCards(now).length + this.newRemaining(now);
    },

    makeQueue(now) {
        const learnAhead = 20 * 60 * 1000;
        return [...this.dueCards(now, learnAhead), ...this.newCards().slice(0, this.newRemaining(now))];
    },

    record(card, rating, now) {
        const previous = this.data.reviews[card.id] || null;
        const next = Scheduler.next(previous, rating, now);
        this.data.reviews[card.id] = next;
        const day = Scheduler.dayKey(now);
        this.data.log[day] = (this.data.log[day] || 0) + 1;
        if (!previous) this.data.introduced[day] = (this.data.introduced[day] || 0) + 1;
        this.save();
        return next;
    },

    streak(now) {
        let day = Scheduler.dayStart(now);
        if (!(this.data.log[Scheduler.dayKey(day)] > 0)) day = new Date(day.getTime() - 86400e3);
        let count = 0;
        while (this.data.log[Scheduler.dayKey(day)] > 0) {
            count += 1;
            day = new Date(day.getTime() - 86400e3);
        }
        return count;
    },

    reviewsByDay(days, now) {
        const today = Scheduler.dayStart(now);
        const dues = this.activeCards.map((c) => this.data.reviews[c.id]).filter(Boolean).map((s) => s.due);
        return Array.from({ length: days }, (_, offset) => {
            const start = today.getTime() + offset * 86400e3;
            const end = start + 86400e3;
            return dues.filter((due) => (due >= start || offset === 0) && due < end).length;
        });
    },

    mastery(deckID) {
        const cards = this.deck.cards.filter((c) => c.deck === deckID && this.data.filter.kinds.includes(c.kind));
        const learned = cards.filter((c) => {
            const rank = Scheduler.rank(this.data.reviews[c.id]);
            return rank === "moon" || rank === "planet" || rank === "star";
        }).length;
        return { learned, total: cards.length };
    },

    reset() {
        this.data.reviews = {};
        this.data.log = {};
        this.data.introduced = {};
        this.save();
    },
};

function interleave(groups) {
    const result = [];
    const longest = Math.max(0, ...groups.map((g) => g.length));
    for (let i = 0; i < longest; i += 1) {
        for (const group of groups) if (i < group.length) result.push(group[i]);
    }
    return result;
}

/// Перемешивание вариантов — тот же алгоритм, что в приложении: порядок стабилен для одного показа.
function shuffleOrder(count, seed) {
    let state = 1469598103934665603n;
    for (const byte of new TextEncoder().encode(seed)) {
        state = BigInt.asUintN(64, (state ^ BigInt(byte)) * 1099511628211n);
    }
    const order = Array.from({ length: count }, (_, i) => i);
    for (let index = count - 1; index > 0; index -= 1) {
        state = BigInt.asUintN(64, state * 6364136223846793005n + 1442695040888963407n);
        const swapWith = Number((state >> 33n) % BigInt(index + 1));
        [order[index], order[swapWith]] = [order[swapWith], order[index]];
    }
    return order;
}

// ------------------------------ Звёздное небо ------------------------------

const Sky = {
    stars: [],
    warpStart: 0,
    canvas: null,
    ctx: null,

    start() {
        this.canvas = document.getElementById("sky");
        this.ctx = this.canvas.getContext("2d");
        this.resize();
        window.addEventListener("resize", () => this.resize());
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduce) {
            this.draw(0);
            return;
        }
        let last = 0;
        const loop = (time) => {
            requestAnimationFrame(loop);
            if (document.hidden || time - last < 33) return;
            last = time;
            this.draw(time / 1000);
        };
        requestAnimationFrame(loop);
    },

    resize() {
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        this.canvas.width = window.innerWidth * ratio;
        this.canvas.height = window.innerHeight * ratio;
        this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        const count = window.innerWidth < 500 ? 120 : 200;
        this.stars = Array.from({ length: count }, (_, i) => ({
            x: Math.random() * window.innerWidth,
            y: Math.random() * window.innerHeight,
            r: 0.4 + Math.random() * 1.3,
            a: 0.3 + Math.random() * 0.6,
            speed: 0.6 + Math.random() * 1.8,
            phase: Math.random() * 6.28,
            warm: Math.random() > 0.82,
        }));
    },

    warp() {
        this.warpStart = performance.now() / 1000;
    },

    warpAmount(time) {
        const elapsed = time - this.warpStart;
        if (!this.warpStart || elapsed < 0 || elapsed > 1.5) return 0;
        if (elapsed < 0.35) return (elapsed / 0.35) ** 2;
        if (elapsed < 0.75) return 1;
        return (1 - (elapsed - 0.75) / 0.75) ** 2;
    },

    draw(time) {
        const { ctx } = this;
        const w = window.innerWidth;
        const h = window.innerHeight;
        ctx.clearRect(0, 0, w, h);

        // Туманность.
        const nebula = ctx.createRadialGradient(w * 0.3, h * 0.22, 0, w * 0.3, h * 0.22, Math.max(w, h) * 0.8);
        nebula.addColorStop(0, "rgba(51, 36, 95, 0.55)");
        nebula.addColorStop(0.5, "rgba(12, 42, 64, 0.25)");
        nebula.addColorStop(1, "rgba(4, 6, 14, 0)");
        ctx.fillStyle = nebula;
        ctx.fillRect(0, 0, w, h);

        const warp = this.warpAmount(time);
        const cx = w / 2;
        const cy = h / 2;
        for (const star of this.stars) {
            const twinkle = 0.62 + 0.38 * Math.sin(time * star.speed + star.phase);
            const alpha = star.a * twinkle;
            const color = star.warm ? "255, 217, 160" : "255, 255, 255";
            if (warp > 0.02) {
                const dx = star.x - cx;
                const dy = star.y - cy;
                const distance = Math.max(1, Math.hypot(dx, dy));
                const push = 1 + warp * 0.2;
                const hx = cx + dx * push;
                const hy = cy + dy * push;
                const len = warp * (16 + distance * 0.35);
                ctx.strokeStyle = `rgba(${color}, ${alpha})`;
                ctx.lineWidth = star.r;
                ctx.beginPath();
                ctx.moveTo(hx - (dx / distance) * len, hy - (dy / distance) * len);
                ctx.lineTo(hx, hy);
                ctx.stroke();
                continue;
            }
            ctx.fillStyle = `rgba(${color}, ${alpha})`;
            ctx.beginPath();
            ctx.arc(star.x, star.y, star.r, 0, 6.2832);
            ctx.fill();
        }
    },
};

// ------------------------------ Экраны ------------------------------

const app = document.getElementById("app");
let session = null;

function show(node) {
    app.replaceChildren(node);
}

function homeScreen() {
    const now = new Date();
    const review = Store.dueCards(now).length;
    const fresh = Store.newRemaining(now);
    const total = review + fresh;
    const streak = Store.streak(now);
    const forecast = Store.reviewsByDay(7, now);
    const peak = Math.max(1, ...forecast);
    const weekday = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

    const screen = $(`
      <div class="screen scroll">
        <div class="top-bar">
          <div class="logo"><b>ОРБИТА</b><span>карточки по физике</span></div>
          <div style="flex:1"></div>
          <div class="pill streak">🔥 ${streak === 0 ? "начни серию" : `${streak} ${daysWord(streak)} подряд`}</div>
          <button class="pill icon" id="settings">⚙</button>
        </div>

        <div class="hero">
          <div class="orbit-ring r1"><i class="sat"></i></div>
          <div class="orbit-ring r2"><i class="sat"></i></div>
          <div class="planet">
            <div class="count">${
                total > 0
                    ? `<b>${total}</b><span>${cardsWord(total)} сегодня</span>`
                    : `<b>✓</b><span>всё повторено</span>`
            }</div>
          </div>
        </div>

        <button class="start" id="start" ${total === 0 ? "disabled" : ""}>
          <span>✦</span> ${total > 0 ? "Начать полёт" : "На сегодня всё"}
        </button>
        <div class="subtitle">${
            total > 0
                ? [review > 0 ? `повторить ${review}` : "", fresh > 0 ? `новых ${fresh}` : ""].filter(Boolean).join(" · ")
                : "Следующие карточки появятся позже"
        }</div>

        <div class="glass panel">
          <h3 class="caps">Что повторяем</h3>
          <div class="chips" id="decks"></div>
          <div class="chips" id="kinds" style="margin-top:8px"></div>
        </div>

        <div class="glass panel">
          <h3 class="caps">Прогноз на неделю</h3>
          <div class="bars">
            ${forecast
                .map(
                    (count, day) => `
              <div class="${day === 0 ? "today" : ""}">
                <b>${count}</b>
                <i style="height:${Math.max(5, (count / peak) * 58)}px"></i>
                ${day === 0 ? "сегодня" : weekday[(new Date(now.getTime() + day * 86400e3).getDay() + 6) % 7]}
              </div>`
                )
                .join("")}
          </div>
        </div>

        <div class="glass panel">
          <h3 class="caps">Звёздный календарь</h3>
          <div class="calendar" id="calendar"></div>
        </div>
      </div>
    `);

    const decks = screen.querySelector("#decks");
    for (const deck of Store.deck.decks) {
        const on = Store.data.filter.decks.includes(deck.id);
        const { learned, total: count } = Store.mastery(deck.id);
        const chip = $(`<button class="chip ${on ? "on" : ""}">${esc(deck.title)}<small>${learned} из ${count} освоено</small></button>`);
        chip.onclick = () => {
            const list = Store.data.filter.decks;
            if (list.includes(deck.id) && list.length > 1) list.splice(list.indexOf(deck.id), 1);
            else if (!list.includes(deck.id)) list.push(deck.id);
            Store.save();
            haptic();
            show(homeScreen());
        };
        decks.append(chip);
    }

    const kinds = screen.querySelector("#kinds");
    for (const kind of ["formula", "question", "problem"]) {
        const on = Store.data.filter.kinds.includes(kind);
        const count = Store.deck.cards.filter((c) => c.kind === kind).length;
        const chip = $(`<button class="chip kind ${on ? "on" : ""}">${KIND_TITLE[kind]} <small>${count} карточек</small></button>`);
        chip.onclick = () => {
            const list = Store.data.filter.kinds;
            if (list.includes(kind) && list.length > 1) list.splice(list.indexOf(kind), 1);
            else if (!list.includes(kind)) list.push(kind);
            Store.save();
            haptic();
            show(homeScreen());
        };
        kinds.append(chip);
    }

    // Звёздный календарь за 12 недель.
    const calendar = screen.querySelector("#calendar");
    const today = Scheduler.dayStart(now);
    const weekdayIndex = (today.getDay() + 6) % 7;
    const start = new Date(today.getTime() - ((11 * 7 + weekdayIndex) * 86400e3));
    for (let week = 0; week < 12; week += 1) {
        const column = $(`<div class="week"></div>`);
        for (let day = 0; day < 7; day += 1) {
            const date = new Date(start.getTime() + (week * 7 + day) * 86400e3);
            const count = Store.data.log[Scheduler.dayKey(date)] || 0;
            const level = count >= 30 ? 3 : count >= 10 ? 2 : count > 0 ? 1 : 0;
            const isToday = Scheduler.dayKey(date) === Scheduler.dayKey(now);
            column.append($(`<i class="${level ? `l${level}` : ""} ${isToday ? "today" : ""}"></i>`));
        }
        calendar.append(column);
    }

    screen.querySelector("#start").onclick = () => startSession();
    screen.querySelector("#settings").onclick = () => openSettings();
    return screen;
}

// ------------------------------ Тренировка ------------------------------

function startSession() {
    const now = new Date();
    const queue = Store.makeQueue(now);
    if (!queue.length) return;
    session = {
        queue,
        total: queue.length,
        answers: 0,
        first: {},
        stars: [],
        combo: 0,
        answer: null,
        flipped: false,
        history: [],
    };
    Sky.warp();
    haptic(18);
    show(sessionScreen());
}

function currentCard() {
    return session.queue[0];
}

function sessionKey() {
    return `${currentCard().id}#${session.answers}`;
}

function sessionScreen() {
    const card = currentCard();
    const order = shuffleOrder(card.choices.length, sessionKey());
    const rank = Scheduler.rank(Store.state(card));
    const progress = session.stars.length / session.total;
    const deck = Store.deckOf(card);

    const screen = $(`
      <div class="screen">
        <div class="session-top">
          <button class="pill icon" id="finish">✕</button>
          <div class="progress-line"><i style="width:${Math.min(1, progress) * 100}%"></i></div>
          <div class="counter">${session.stars.length} <span>/ ${session.total}</span></div>
        </div>
        <div id="combo-slot"></div>
        <div class="card-area">
          <div class="card glass" id="card">
            <div class="face front" id="front"></div>
            <div class="face back glass" id="back"></div>
          </div>
        </div>
        <div id="actions"></div>
      </div>
    `);

    if (session.combo >= 2) {
        screen.querySelector("#combo-slot").append($(`<div class="combo">🔥 ${session.combo} подряд</div>`));
    }

    // Лицевая сторона.
    const front = screen.querySelector("#front");
    front.append(
        $(`
      <div class="card-head">
        <span class="caps">${esc(deck ? deck.title : "")}</span>
        <span class="pill rank">${Store.state(card) ? `${RANK_ICON[rank]} ${RANK_TITLE[rank]}` : "✦ новая"}</span>
      </div>
    `)
    );
    front.append(
        $(`
      <div class="front-top">
        <div class="caps" style="color:var(--cyan)">${frontLabel(card)}</div>
        <div class="prompt ${card.prompt.length > 60 ? "long" : ""}">${esc(card.solution ? card.solution.problem : card.prompt)}</div>
        ${
            card.solution && card.solution.given
                ? `<div class="given">${card.solution.given.map((g) => `<span>${math(g)}</span>`).join("")}</div>`
                : ""
        }
      </div>
    `)
    );

    const choices = $(`<div class="choices"></div>`);
    order.forEach((index, position) => {
        const choice = card.choices[index];
        const button = $(`<button class="choice"><b>${position + 1}</b><span>${choiceHTML(choice)}</span></button>`);
        button.onclick = () => chooseAnswer(index, button);
        choices.append(button);
    });
    front.append(choices);
    front.append($(`<div class="card-foot" id="foot">Выбери ответ · или нажми «Не знаю»</div>`));

    // Оборот строим сразу, но он скрыт поворотом — на телефоне это быстро.
    screen.querySelector("#back").append(backContent(card, order));

    screen.querySelector("#finish").onclick = () => finishSession();
    renderActions(screen);
    return screen;
}

function backContent(card, order) {
    const correctIndex = card.choices.findIndex((c) => !c.why);
    const picked = session.answer;
    const correct = picked !== null && picked !== undefined && picked === correctIndex;
    const wrong = order.filter((i) => card.choices[i].why).sort((a, b) => (a === picked ? -1 : b === picked ? 1 : 0));

    const wrap = $(`<div class="scroll" style="flex:1;min-height:0"></div>`);
    wrap.append(
        $(`
      <div>
        <div class="verdict ${correct ? "ok" : "no"}">${correct ? "✓ Верно!" : picked === null ? "Смотрим ответ" : "✕ Неверно — разбор ниже"}</div>
        <div class="prompt">${esc(card.solution ? card.solution.problem : card.prompt)}</div>
        ${card.formula ? `<div class="formula-panel">${math(card.formula, true)}</div>` : ""}
        ${
            card.legend && card.legend.length
                ? `<div class="legend">${card.legend
                      .map((item) => `<div>${math(item.symbol)} <span>(${esc(item.meaning)})</span></div>`)
                      .join("")}</div>`
                : ""
        }
        ${card.answer ? `<div class="answer-text">${esc(card.answer)}</div>` : ""}
      </div>
    `)
    );

    if (card.solution) wrap.append(solutionBlock(card.solution));

    if (wrong.length) {
        wrap.append(
            $(`
          <div class="why">
            <div class="caps">Почему не другие варианты</div>
            ${wrong
                .map(
                    (i) => `
              <div class="item ${i === picked ? "picked" : ""}">
                ${i === picked ? `<div class="tag">ТВОЙ ОТВЕТ</div>` : ""}
                <div>${choiceHTML(card.choices[i])}</div>
                <p>${esc(card.choices[i].why)}</p>
              </div>`
                )
                .join("")}
          </div>
        `)
        );
    }

    if (card.note) wrap.append($(`<div class="note">${esc(card.note)}</div>`));

    if (card.example) {
        const button = $(`<button class="ghost-button warm">✦ Пример с решением</button>`);
        button.onclick = () => openExample(card);
        wrap.append(button);
    }

    wrap.append($(`<div class="source">${esc(card.source)}</div>`));
    return wrap;
}

function solutionBlock(example) {
    return $(`
      <div>
        <div class="caps" style="margin-bottom:8px">Решение</div>
        <div class="steps">
          ${example.steps
              .map(
                  (step, index) => `
            <div class="step">
              <b>${index + 1}</b>
              <div class="body">
                <p>${esc(step.text)}</p>
                ${step.formula ? `<div class="math">${math(step.formula, true)}</div>` : ""}
              </div>
            </div>`
              )
              .join("")}
        </div>
        ${
            example.result || example.conclusion
                ? `<div class="result-panel">
                     <div class="caps">Ответ</div>
                     ${example.result ? math(example.result, true) : ""}
                     ${example.conclusion ? `<div class="note" style="margin:6px 0 0">${esc(example.conclusion)}</div>` : ""}
                   </div>`
                : ""
        }
      </div>
    `);
}

function chooseAnswer(index, button) {
    if (session.answer !== null && session.answer !== undefined) return;
    if (session.flipped) return;
    const card = currentCard();
    const correct = !card.choices[index].why;
    session.answer = index;
    session.combo = correct ? session.combo + 1 : 0;
    haptic(correct ? 14 : 30);

    const buttons = [...document.querySelectorAll(".choice")];
    const order = shuffleOrder(card.choices.length, sessionKey());
    buttons.forEach((element, position) => {
        const choiceIndex = order[position];
        if (!card.choices[choiceIndex].why) element.classList.add("correct");
        else if (choiceIndex === index) element.classList.add("wrong");
        else element.classList.add("dim");
    });
    if (correct) sparkle(button);

    const foot = document.getElementById("foot");
    if (foot) {
        foot.className = `card-foot ${correct ? "verdict-correct" : "verdict-wrong"}`;
        foot.textContent = correct ? "Верно! Переворачиваем…" : "Не то — смотрим разбор…";
    }
    setTimeout(() => flip(), correct ? 800 : 1250);
}

function giveUp() {
    if (session.flipped || (session.answer !== null && session.answer !== undefined)) return;
    session.answer = null;
    session.combo = 0;
    flip();
}

function flip() {
    if (session.flipped) return;
    session.flipped = true;
    const card = document.getElementById("card");
    const back = document.getElementById("back");
    if (back) back.replaceChildren(backContent(currentCard(), shuffleOrder(currentCard().choices.length, sessionKey())));
    if (card) card.classList.add("flipped");
    renderActions(document.querySelector(".screen"));
    haptic();
}

function renderActions(screen) {
    const slot = screen.querySelector("#actions");
    slot.replaceChildren();
    const card = currentCard();
    if (!session.flipped) {
        const button = $(`<button class="ghost-button" style="margin-top:10px">Не знаю — показать ответ</button>`);
        button.onclick = () => giveUp();
        slot.append(button);
        return;
    }
    const correctIndex = card.choices.findIndex((c) => !c.why);
    const correct = session.answer === correctIndex;
    const ratings = correct ? [2, 3, 4] : [1];
    const now = new Date();
    const row = $(`<div class="ratings"></div>`);
    for (const rating of ratings) {
        const preview = Scheduler.preview(Store.state(card), rating, now);
        const button = $(
            `<button class="rate ${RATING_CLASS[rating]}">${correct ? RATING_TITLE[rating] : "Повторить позже"}<span>${preview}</span></button>`
        );
        button.onclick = () => rate(rating);
        row.append(button);
    }
    slot.append(row);
}

function rate(rating) {
    const card = currentCard();
    const now = new Date();
    const before = Scheduler.rank(Store.state(card));
    const state = Store.record(card, rating, now);
    const after = Scheduler.rank(state);
    const order = ["dust", "moon", "planet", "star"];
    if (order.indexOf(after) > order.indexOf(before) && after !== "dust") {
        showToast(`${RANK_ICON[after]} Новый уровень: ${RANK_TITLE[after]}`);
    }

    const correctIndex = card.choices.findIndex((c) => !c.why);
    session.history.push({ card, outcome: session.answer === null ? "gaveUp" : session.answer === correctIndex ? "correct" : "wrong", rating });
    if (!session.first[card.id]) session.first[card.id] = rating;
    session.answers += 1;
    session.queue.shift();
    const completed = state.step === null;
    if (completed) {
        session.stars.push(session.first[card.id]);
    } else {
        const position = rating === 1 ? Math.min(3, session.queue.length) : session.queue.length;
        session.queue.splice(position, 0, card);
    }
    session.answer = null;
    session.flipped = false;
    haptic();

    if (!session.queue.length) {
        finishSession();
        return;
    }
    show(sessionScreen());
}

function finishSession() {
    if (!session || session.answers === 0) {
        session = null;
        show(homeScreen());
        return;
    }
    const result = session;
    session = null;
    show(summaryScreen(result));
}

// ------------------------------ Пример, итоги, настройки ------------------------------

function openExample(card) {
    const example = card.example;
    const order = shuffleOrder(example.choices.length, `${card.id}-example`);
    const sheet = $(`
      <div class="sheet">
        <div class="body scroll">
          <div class="sheet-head">
            <span class="caps">✦ Пример</span>
            <button id="close">Закрыть</button>
          </div>
          <div class="prompt" style="font-size:16px">${esc(example.problem)}</div>
          ${
              example.given
                  ? `<div class="given">${example.given.map((g) => `<span>${math(g)}</span>`).join("")}</div>`
                  : ""
          }
          <div class="caps" style="margin-bottom:8px">Выбери ответ</div>
          <div class="choices" id="example-choices"></div>
          <button class="ghost-button warm" id="show-solution" style="margin-top:12px">Показать решение</button>
          <div id="example-solution"></div>
        </div>
      </div>
    `);

    const choices = sheet.querySelector("#example-choices");
    let answered = false;
    order.forEach((index, position) => {
        const choice = example.choices[index];
        const button = $(`<button class="choice"><b>${position + 1}</b><span>${choiceHTML(choice)}</span></button>`);
        button.onclick = () => {
            if (answered) return;
            answered = true;
            haptic(choice.why ? 30 : 14);
            [...choices.children].forEach((element, i) => {
                const choiceIndex = order[i];
                if (!example.choices[choiceIndex].why) element.classList.add("correct");
                else if (choiceIndex === index) element.classList.add("wrong");
                else element.classList.add("dim");
            });
            if (!choice.why) sparkle(button);
            revealSolution(index);
        };
        choices.append(button);
    });

    const solutionButton = sheet.querySelector("#show-solution");
    const revealSolution = (picked) => {
        solutionButton.remove();
        const solution = sheet.querySelector("#example-solution");
        solution.append(solutionBlock(example));
        const wrong = example.choices.map((c, i) => (c.why ? { c, i } : null)).filter(Boolean);
        if (wrong.length) {
            solution.append(
                $(`
              <div class="why">
                <div class="caps">Почему не другие варианты</div>
                ${wrong
                    .map(
                        ({ c, i }) => `
                  <div class="item ${i === picked ? "picked" : ""}">
                    ${i === picked ? `<div class="tag">ТВОЙ ОТВЕТ</div>` : ""}
                    <div>${choiceHTML(c)}</div>
                    <p>${esc(c.why)}</p>
                  </div>`
                    )
                    .join("")}
              </div>
            `)
            );
        }
        solution.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    solutionButton.onclick = () => revealSolution(-1);

    sheet.querySelector("#close").onclick = () => sheet.remove();
    sheet.onclick = (event) => {
        if (event.target === sheet) sheet.remove();
    };
    document.body.append(sheet);
}

function summaryScreen(result) {
    const remembered = Object.values(result.first).filter((r) => r >= 3).length;
    const struggled = Object.values(result.first).filter((r) => r <= 2).length;
    const streak = Store.streak(new Date());
    const ratio = remembered / Math.max(1, remembered + struggled);
    const title = ratio >= 0.8 ? "Идеальная орбита" : ratio >= 0.5 ? "Полёт завершён" : "Трудный полёт позади";

    const screen = $(`
      <div class="screen">
        <div class="summary">
          <canvas id="constellation"></canvas>
          <h1>${title}</h1>
          <div class="subtitle">${result.stars.length} ${cardsWord(result.stars.length)} на орбите</div>
          <div class="stats">
            <div class="glass"><b>${remembered}</b><span>вспомнено сразу</span></div>
            <div class="glass"><b>${struggled}</b><span>было трудно</span></div>
            <div class="glass"><b>${streak}</b><span>${daysWord(streak)} подряд</span></div>
          </div>
        </div>
        <button class="big-button" id="again" style="margin-bottom:10px">Ещё круг</button>
        <button class="big-button quiet" id="home">На орбиту</button>
      </div>
    `);

    drawConstellation(screen.querySelector("#constellation"), result.stars);
    const more = Store.dueCount(new Date());
    const again = screen.querySelector("#again");
    if (more > 0) {
        again.textContent = `Ещё круг · ${more}`;
        again.onclick = () => startSession();
    } else {
        again.remove();
    }
    screen.querySelector("#home").onclick = () => show(homeScreen());
    return screen;
}

function drawConstellation(canvas, stars) {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = canvas.clientWidth || 340;
    const height = 260;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    // Звёзды раскиданы по полю, а линии идут цепочкой от самой левой к ближайшей — как в приложении на Маке.
    const random = (seed) => {
        const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
        return value - Math.floor(value);
    };
    const inset = 26;
    const scattered = stars.slice(0, 24).map((rating, index) => ({
        x: inset + random(index * 7 + 1) * (width - inset * 2),
        y: inset + random(index * 13 + 5) * (height - inset * 2),
        rating,
    }));
    const points = [];
    if (scattered.length) {
        const rest = [...scattered];
        let current = rest.splice(rest.indexOf(rest.reduce((a, b) => (a.x < b.x ? a : b))), 1)[0];
        points.push(current);
        while (rest.length) {
            const nearest = rest.reduce((best, point) =>
                Math.hypot(point.x - current.x, point.y - current.y) < Math.hypot(best.x - current.x, best.y - current.y) ? point : best
            );
            rest.splice(rest.indexOf(nearest), 1);
            points.push(nearest);
            current = nearest;
        }
    }

    let step = 0;
    const animate = () => {
        step += 1;
        ctx.clearRect(0, 0, width, height);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
        ctx.lineWidth = 0.9;
        const shown = Math.min(points.length, Math.floor(step / 6));
        for (let i = 1; i < shown; i += 1) {
            ctx.beginPath();
            ctx.moveTo(points[i - 1].x, points[i - 1].y);
            ctx.lineTo(points[i].x, points[i].y);
            ctx.stroke();
        }
        points.slice(0, shown).forEach((point) => {
            const color = RATING_COLOR[point.rating] || "#86E6FF";
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.arc(point.x, point.y, 4, 0, 6.2832);
            ctx.fill();
            ctx.shadowBlur = 0;
        });
        if (shown < points.length) requestAnimationFrame(animate);
    };
    animate();
}

function openSettings() {
    const sheet = $(`
      <div class="sheet">
        <div class="body scroll">
          <div class="sheet-head"><span class="caps">Настройки</span><button id="close">Закрыть</button></div>
          <div class="settings-row">
            <div class="grow">Новых карточек в день<small>знакомые возвращаются сами</small></div>
            <div class="stepper"><button id="minus">−</button><b id="value">${Store.data.newPerDay}</b><button id="plus">+</button></div>
          </div>
          <div class="settings-row">
            <div class="grow">Прогресс<small>хранится в этом телефоне</small></div>
            <button class="pill danger" id="reset">Сбросить</button>
          </div>
          <div class="settings-row">
            <div class="grow">Колода<small>${Store.deck.cards.length} карточек по лекциям: кинематика, динамика, погрешности</small></div>
          </div>
        </div>
      </div>
    `);
    const value = sheet.querySelector("#value");
    sheet.querySelector("#minus").onclick = () => {
        Store.data.newPerDay = Math.max(5, Store.data.newPerDay - 5);
        value.textContent = Store.data.newPerDay;
        Store.save();
    };
    sheet.querySelector("#plus").onclick = () => {
        Store.data.newPerDay = Math.min(30, Store.data.newPerDay + 5);
        value.textContent = Store.data.newPerDay;
        Store.save();
    };
    sheet.querySelector("#reset").onclick = () => {
        if (!confirm("Сбросить весь прогресс? Карточки снова станут новыми.")) return;
        Store.reset();
        sheet.remove();
        show(homeScreen());
    };
    const close = () => {
        sheet.remove();
        show(homeScreen());
    };
    sheet.querySelector("#close").onclick = close;
    sheet.onclick = (event) => {
        if (event.target === sheet) close();
    };
    document.body.append(sheet);
}

function showToast(text) {
    const toast = $(`<div class="toast">${esc(text)}</div>`);
    document.body.append(toast);
    setTimeout(() => toast.remove(), 2500);
}

/// Искры от выбранного варианта.
function sparkle(element) {
    const box = element.getBoundingClientRect();
    const colors = ["#9CF2CB", "#86E6FF", "#FFD9A0", "#FFFFFF"];
    for (let i = 0; i < 14; i += 1) {
        const spark = document.createElement("div");
        spark.className = "spark";
        const angle = Math.random() * 6.2832;
        const distance = 40 + Math.random() * 70;
        spark.style.left = `${box.left + box.width * Math.random()}px`;
        spark.style.top = `${box.top + box.height / 2}px`;
        spark.style.background = colors[i % colors.length];
        spark.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
        spark.style.setProperty("--dy", `${Math.sin(angle) * distance}px`);
        document.body.append(spark);
        setTimeout(() => spark.remove(), 900);
    }
}

// ------------------------------ Клавиатура (на компьютере) ------------------------------

window.addEventListener("keydown", (event) => {
    if (!session) {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            startSession();
        }
        return;
    }
    const digit = Number(event.key);
    if (!session.flipped) {
        if (digit >= 1 && digit <= 4) {
            const button = document.querySelectorAll(".choice")[digit - 1];
            if (button) button.click();
        } else if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            giveUp();
        }
        return;
    }
    if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        const buttons = document.querySelectorAll(".rate");
        (buttons[buttons.length - 1] || buttons[0])?.click();
    } else if (digit >= 1 && digit <= 4) {
        document.querySelector(`.rate.${RATING_CLASS[digit]}`)?.click();
    } else if (event.key === "Escape") {
        finishSession();
    }
});

// ------------------------------ Запуск ------------------------------

(async () => {
    Sky.start();
    await Store.load();
    show(homeScreen());
    // На localhost (разработка) кэш только мешает: файлы меняются, а страница показывает старые.
    const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
    if ("serviceWorker" in navigator && !isLocal) {
        navigator.serviceWorker.register("sw.js").catch(() => {});
    } else if (isLocal && "serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((r) => r.unregister()));
        if (window.caches) for (const key of await caches.keys()) await caches.delete(key);
    }
})();
