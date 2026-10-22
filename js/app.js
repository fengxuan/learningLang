/* global TONES, MIRROR, HERO_IDS, CHANT, SENTENCES, speechSynthesis, SpeechSynthesisUtterance */
(function () {
  const STORAGE_KEY = "shengqiao-practice-v2";
  const SHADOW_MS = 2800;
  const PREFER = {
    "zh-HK": ["sinji", "善怡"],
    "zh-CN": ["tingting", "婷婷"],
    "en-US": ["samantha"],
    "ja-JP": ["kyoko"],
  };

  const STEPS = [
    { id: "listen", label: "盲听", kicker: "例子", title: "先不要看字" },
    { id: "meaning", label: "意思", kicker: "例子", title: "这句在说什么" },
    { id: "shadow", label: "跟读", kicker: "模仿", title: "跟着高低说三遍" },
    { id: "map", label: "对上", kicker: "对应", title: "一块声音，一个意思" },
    { id: "en", label: "英语", kicker: "迁移", title: "同一句，换成英语" },
    { id: "ja", label: "日语", kicker: "迁移", title: "同一句，换成日语" },
  ];

  const bus = {
    gen: 0,
    stop() {
      const prev = this.gen;
      this.gen += 1;
      if (this._audio) {
        const audio = this._audio;
        audio.onended = null;
        audio.onerror = null;
        try { audio.pause(); } catch (err) { /* ignore */ }
        if (audio._finish) {
          const finish = audio._finish;
          audio._finish = null;
          finish(false);
        }
      }
      if (canSpeak()) {
        try { speechSynthesis.cancel(); } catch (err) { /* ignore */ }
      }
      document.querySelectorAll("[data-play-gen]").forEach((node) => {
        if (node.dataset.playGen === String(prev)) {
          node.classList.remove("is-playing");
          delete node.dataset.playGen;
        }
      });
      return this.gen;
    },
    async speak(text, lang, rate, gen) {
      if (gen !== this.gen) return false;
      if (String(lang).toLowerCase().startsWith("ja")) {
        const speed = rate <= 0.7 ? 0.82 : 1;
        const url = "https://fanyi.baidu.com/gettts?lan=jp&spd=3&source=web&text=" + encodeURIComponent(text);
        return this.playUrl(url, speed, gen);
      }
      if (!canSpeak()) return false;
      const voices = speechSynthesis.getVoices();
      const voice = pickVoice(lang);
      if (voices.length && !voice) return false;
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = lang;
      utter.rate = rate;
      if (voice) {
      try { utter.voice = voice; } catch (err) { /* keep the language tag */ }
    }
      this._utter = utter;
      return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(value && gen === this.gen);
        };
        utter.onend = () => finish(true);
        utter.onerror = () => finish(false);
        // Safari drops the utterance when cancel() and speak() run in one turn.
        setTimeout(() => {
          if (gen !== this.gen) return finish(false);
          try {
            speechSynthesis.cancel();
            speechSynthesis.resume();
            speechSynthesis.speak(utter);
          } catch (err) {
            finish(false);
          }
        }, 80);
        setTimeout(() => finish(false), 12000);
      });
    },
    playUrl(url, speed, gen) {
      return new Promise((resolve) => {
        if (gen !== this.gen) {
          resolve(false);
          return;
        }
        const audio = this._player || new Audio();
        this._player = audio;
        if (audio._finish) {
          const previous = audio._finish;
          audio._finish = null;
          previous(false);
        }
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          if (audio._finish === finish) audio._finish = null;
          resolve(value);
        };
        audio._finish = finish;
        this._audio = audio;
        audio.preload = "auto";
        audio.referrerPolicy = "no-referrer";
        audio.playbackRate = speed;
        audio.onended = () => finish(gen === this.gen);
        audio.onerror = () => finish(false);
        audio.src = url;
        const started = audio.play();
        if (started && started.catch) started.catch(() => finish(false));
        setTimeout(() => finish(false), 20000);
      });
    },
    async playJyutping(jyut, rate, gen) {
      const parts = String(jyut).trim().split(/\s+/).filter(Boolean);
      if (!parts.length || gen !== this.gen) return false;
      const speed = rate <= 0.7 ? 0.68 : 1;
      const gap = rate <= 0.7 ? 180 : 40;
      for (let index = 0; index < parts.length; index += 1) {
        if (gen !== this.gen) return false;
        const ok = await this.playUrl("https://words.hk/static/jyutping/" + parts[index] + ".mp3", speed, gen);
        if (!ok || gen !== this.gen) return false;
        if (index < parts.length - 1) {
          const still = await wait(gap, gen);
          if (!still) return false;
        }
      }
      return true;
    },
  };

  let book = { current: "slower", scenes: {} };
  let progress = loadProgress();
  let view = progress.finished ? 6 : progress.step;
  let heroId = HERO_IDS[0];
  let kindFilter = "all";
  let toneFilter = 0;
  let chantIndex = 0;
  let sceneId = progress.sceneId;
  let armedMeaning = null;
  let heardChips = new Set();
  let lastFeedback = "";

  function canSpeak() {
    return typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";
  }

  function wait(ms, gen) {
    return new Promise((resolve) => {
      const start = Date.now();
      const timer = setInterval(() => {
        if (gen != null && gen !== bus.gen) {
          clearInterval(timer);
          resolve(false);
          return;
        }
        if (Date.now() - start >= ms) {
          clearInterval(timer);
          resolve(true);
        }
      }, 80);
    });
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    const props = attrs || {};
    Object.keys(props).forEach((key) => {
      const value = props[key];
      if (value == null || value === false) return;
      if (key === "class") node.className = value;
      else if (key === "onClick") node.addEventListener("click", value);
      else node.setAttribute(key, value === true ? "" : String(value));
    });
    if (tag === "button" && !node.hasAttribute("type")) node.type = "button";
    const list = Array.isArray(children) ? children : [children];
    list.forEach((child) => {
      if (child == null || child === false) return;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  function jyutEl(value) {
    const wrap = el("span", { class: "jyut" });
    String(value).trim().split(/\s+/).forEach((part, index) => {
      if (index) wrap.append(" ");
      const matched = part.match(/^(.*?)([1-6])$/);
      if (!matched) {
        wrap.append(part);
        return;
      }
      wrap.append(el("span", { class: "sy" }, [
        matched[1],
        el("sup", { class: "sy__t t" + matched[2] }, [matched[2]]),
      ]));
    });
    return wrap;
  }

  function decorateJyut(scope) {
    (scope || document).querySelectorAll("[data-jyut]").forEach((node) => {
      const rendered = jyutEl(node.dataset.jyut);
      node.classList.forEach((name) => rendered.classList.add(name));
      node.replaceWith(rendered);
    });
  }

  function yueTones(jyut) {
    return String(jyut).trim().split(/\s+/).map((part) => {
      const matched = part.match(/([1-6])$/);
      return matched ? Number(matched[1]) : null;
    }).filter((tone) => tone != null);
  }

  function contourSVG(tones, system, width, height) {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("class", "contour");
    svg.setAttribute("aria-hidden", "true");
    const mid = document.createElementNS(svgNS, "line");
    mid.setAttribute("x1", "0");
    mid.setAttribute("x2", String(width));
    mid.setAttribute("y1", String(height / 2));
    mid.setAttribute("y2", String(height / 2));
    mid.setAttribute("class", "contour__base");
    svg.appendChild(mid);
    const specs = TONES[system];
    const gap = tones.length > 1 ? 10 : 0;
    const seg = (width - gap * (tones.length - 1)) / Math.max(tones.length, 1);
    tones.forEach((tone, index) => {
      const spec = specs[tone] || specs[1];
      const pts = spec.pts;
      const x0 = index * (seg + gap);
      const d = pts.map((point, pointIndex) => {
        const x = x0 + (pts.length === 1 ? seg / 2 : (seg * pointIndex) / (pts.length - 1));
        const y = 6 + (1 - point) * (height - 12);
        return (pointIndex === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1);
      }).join(" ");
      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", d);
      path.setAttribute("pathLength", "1");
      path.setAttribute("class", "contour__p t" + tone);
      svg.appendChild(path);
    });
    return svg;
  }

  function toneCaption(tones, system) {
    return tones.map((tone) => {
      if (tone === 0) return "轻声";
      if (system === "zh") return ["", "一声", "二声", "三声", "四声"][tone] + " " + TONES.zh[tone].name;
      return tone + " " + TONES.yue[tone].name;
    }).join(" · ");
  }

  function pickVoice(lang) {
    if (!canSpeak()) return null;
    const want = lang.toLowerCase();
    const voices = speechSynthesis.getVoices().filter((voice) => {
      const code = (voice.lang || "").toLowerCase().replaceAll("_", "-");
      if (code.startsWith(want.toLowerCase())) return true;
      if (want === "zh-hk" && (code.includes("hk") || code.startsWith("yue"))) return true;
      return false;
    });
    const keys = PREFER[lang] || [];
    for (const key of keys) {
      const found = voices.find((voice) => voice.name.toLowerCase().includes(key.toLowerCase()));
      if (found) return found;
    }
    return voices[0] || null;
  }

  function setVoiceStatus() {
    const banner = document.getElementById("voiceBanner");
    const line = document.getElementById("voiceLine");
    if (line) line.textContent = "粤语按粤拼播放";
    if (!banner) return;
    if (!canSpeak()) {
      banner.hidden = false;
      banner.textContent = "粤语按粤拼播放。这只浏览器不能朗读英语和日语。";
      return;
    }
    banner.hidden = true;
  }

  async function withPlaying(button, task) {
    const gen = bus.stop();
    if (button) {
      button.classList.add("is-playing");
      button.dataset.playGen = String(gen);
    }
    try {
      return await task(gen);
    } finally {
      if (button && button.dataset.playGen === String(gen)) {
        button.classList.remove("is-playing");
        delete button.dataset.playGen;
      }
    }
  }

  function playIcon() {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 12 12");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", "M3 1.5v9l8-4.5-8-4.5z");
    path.setAttribute("fill", "currentColor");
    svg.appendChild(path);
    return svg;
  }

  function findMirror(id) {
    return MIRROR.find((item) => item.id === id);
  }

  function renderHero() {
    const root = document.getElementById("heroStage");
    const item = findMirror(heroId);
    const yueT = yueTones(item.yue.jyut);
    root.replaceChildren(el("div", { class: "stage" }, [
      el("p", { class: "stage__tag" }, [item.tag]),
      el("div", { class: "faces" }, [
        el("div", {}, [
          el("span", { class: "face__k" }, ["普通话"]),
          el("span", { class: "face__c", lang: "zh-CN" }, [item.zh.text]),
          el("span", { class: "face__read read" }, [item.zh.py + " · " + toneCaption(item.zh.tones, "zh")]),
        ]),
        el("div", {}, [
          el("span", { class: "face__k" }, ["粤语"]),
          el("span", { class: "face__c", lang: "yue" }, [item.yue.text]),
          el("span", { class: "face__read" }, [
            jyutEl(item.yue.jyut),
            " · " + toneCaption(yueT, "yue"),
          ]),
        ]),
      ]),
      el("div", { class: "contours" }, [
        contourSVG(item.zh.tones, "zh", 280, 72),
        contourSVG(yueT, "yue", 280, 72),
      ]),
      el("div", { class: "stage__actions" }, [
        el("button", {
          class: "btn btn--solid",
          onClick(event) {
            withPlaying(event.currentTarget, async (gen) => {
              await bus.speak(item.zh.text, "zh-CN", 0.92, gen);
              if (gen !== bus.gen) return;
              await wait(360, gen);
              if (gen !== bus.gen) return;
              await bus.playJyutping(item.yue.jyut, 0.82, gen);
            });
          },
        }, ["对比着听"]),
        el("button", {
          class: "btn btn--small",
          onClick(event) { withPlaying(event.currentTarget, (gen) => bus.speak(item.zh.text, "zh-CN", 0.92, gen)); },
        }, ["只听普通话"]),
        el("button", {
          class: "btn btn--small",
          onClick(event) { withPlaying(event.currentTarget, (gen) => bus.playJyutping(item.yue.jyut, 0.82, gen)); },
        }, ["只听粤语"]),
      ]),
      el("p", { class: "stage__note" }, [item.note]),
      el("div", { class: "pills" }, HERO_IDS.map((id) => {
        const sample = findMirror(id);
        const label = sample.zh.text === sample.yue.text ? sample.zh.text : sample.zh.text + " / " + sample.yue.text;
        return el("button", {
          class: "pill" + (id === heroId ? " is-on" : ""),
          "aria-pressed": id === heroId ? "true" : "false",
          onClick() {
            heroId = id;
            renderHero();
          },
        }, [label]);
      })),
      el("p", { class: "voice-line", id: "voiceLine" }, ["正在检测朗读语音"]),
    ]));
    setVoiceStatus();
  }

  function renderMirror() {
    const root = document.getElementById("mirrorRoot");
    const grid = el("div", { class: "cards" });
    MIRROR.forEach((item) => {
      const tones = yueTones(item.yue.jyut);
      const card = el("article", { class: "card", "data-id": item.id, "data-kind": item.kind, "data-tones": tones.join(",") }, [
        el("p", { class: "card__tag" }, [item.tag]),
        el("div", { class: "card__faces" }, [
          el("div", {}, [
            el("span", { class: "card__lang" }, ["普通话"]),
            el("strong", { class: "card__hz", lang: "zh-CN" }, [item.zh.text]),
            el("span", { class: "read" }, [item.zh.py]),
            el("span", { class: "fine" }, [toneCaption(item.zh.tones, "zh")]),
          ]),
          el("div", {}, [
            el("span", { class: "card__lang" }, ["粤语"]),
            el("strong", { class: "card__hz", lang: "yue" }, [item.yue.text]),
            jyutEl(item.yue.jyut),
            el("span", { class: "fine" }, [toneCaption(tones, "yue")]),
          ]),
        ]),
        contourSVG(tones, "yue", 300, 64),
        el("div", { class: "card__actions" }, [
          el("button", { class: "btn btn--small", "data-act": "zh" }, [playIcon(), "普通话"]),
          el("button", { class: "btn btn--small", "data-act": "yue" }, [playIcon(), "粤语"]),
        ]),
        el("p", { class: "card__note" }, [item.note]),
      ]);
      if (item.extra) {
        card.append(el("div", { class: "card__extra" }, [
          el("span", {}, ["还有 ", item.extra.text, " · ", item.extra.gloss, " "]),
          jyutEl(item.extra.jyut),
          el("button", { class: "iconbtn", "data-act": "extra", "aria-label": "听" + item.extra.text }, [playIcon()]),
        ]));
      }
      grid.append(card);
    });

    const toneButtons = [1, 2, 3, 4, 5, 6].map((tone) => {
      const button = el("button", { class: "tone", "data-tone": String(tone) }, [
        contourSVG([tone], "yue", 72, 28),
        String(tone) + " " + TONES.yue[tone].name,
      ]);
      button.addEventListener("click", () => {
        toneFilter = toneFilter === tone ? 0 : tone;
        applyMirrorFilter();
      });
      return button;
    });

    const kindButtons = [
      ["all", "全部"],
      ["same", "同一个字"],
      ["swap", "换了个词"],
    ].map(([kind, label]) => el("button", {
      class: "filter" + (kindFilter === kind ? " is-on" : ""),
      "data-kind": kind,
      onClick() {
        kindFilter = kind;
        applyMirrorFilter();
      },
    }, [label]));

    const count = el("p", { class: "count", id: "mirrorCount" }, [""]);
    const empty = el("p", { class: "fine", id: "mirrorEmpty", hidden: true }, ["这个筛选下没有例子。"]);
    root.replaceChildren(
      el("div", { class: "toolbar" }, [
        el("div", { class: "filters", role: "group", "aria-label": "按词的关系筛选" }, kindButtons),
        el("div", { class: "tones", role: "group", "aria-label": "按粤语声调筛选" }, toneButtons),
        el("div", { class: "inline-actions" }, [
          el("button", {
            class: "btn btn--small",
            id: "pairHai",
            onClick(event) {
              withPlaying(event.currentTarget, async (gen) => {
                flashCard("hai");
                await bus.playJyutping("hai6", 0.78, gen);
                if (gen !== bus.gen) return;
                await wait(420, gen);
                if (gen !== bus.gen) return;
                flashCard("hai2");
                await bus.playJyutping("hai2", 0.78, gen);
              });
            },
          }, ["连听「系」和「喺」"]),
        ]),
        count,
        el("p", { class: "fine" }, ["点一个声调，只看带这个声调的词。以 p、t、k 结尾的音节会特别短。图是示意，用来看见高低。"]),
      ]),
      grid,
      empty
    );
    grid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-act]");
      if (!button) return;
      const item = findMirror(button.closest(".card").dataset.id);
      const act = button.dataset.act;
      if (act === "zh") withPlaying(button, (gen) => bus.speak(item.zh.text, "zh-CN", 0.92, gen));
      if (act === "yue") withPlaying(button, (gen) => bus.playJyutping(item.yue.jyut, 0.82, gen));
      if (act === "extra") withPlaying(button, (gen) => bus.playJyutping(item.extra.jyut, 0.8, gen));
    });
    applyMirrorFilter();
  }

  function flashCard(id) {
    const card = document.querySelector('.card[data-id="' + id + '"]');
    if (!card) return;
    card.classList.remove("is-flash");
    void card.offsetWidth;
    card.classList.add("is-flash");
  }

  function applyMirrorFilter() {
    let shown = 0;
    document.querySelectorAll("#mirrorRoot .card").forEach((card) => {
      const tones = card.dataset.tones.split(",").map(Number);
      const kindOk = kindFilter === "all" || card.dataset.kind === kindFilter;
      const toneOk = !toneFilter || tones.includes(toneFilter);
      const visible = kindOk && toneOk;
      card.hidden = !visible;
      if (visible) shown += 1;
    });
    document.querySelectorAll("#mirrorRoot .filter").forEach((button) => {
      const on = button.dataset.kind === kindFilter;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    });
    document.querySelectorAll("#mirrorRoot .tone").forEach((button) => {
      const on = Number(button.dataset.tone) === toneFilter;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    });
    const count = document.getElementById("mirrorCount");
    if (count) count.textContent = shown + " 个例子";
    const empty = document.getElementById("mirrorEmpty");
    if (empty) empty.hidden = shown !== 0;
  }

  function renderChant() {
    const root = document.getElementById("chantRoot");
    const list = el("div", { class: "line-list" });
    CHANT.lines.forEach((line, index) => {
      list.append(el("button", {
        class: "linepick" + (index === chantIndex ? " is-on" : ""),
        onClick() {
          if (index === chantIndex) return;
          bus.stop();
          chantIndex = index;
          renderChant();
        },
      }, [
        el("b", {}, [String(index + 1).padStart(2, "0")]),
        el("span", { lang: "yue" }, [line.text]),
      ]));
    });
    const line = CHANT.lines[chantIndex];
    const status = el("p", { class: "status", "aria-live": "polite" }, [""]);
    const dots = el("div", { class: "dots", "aria-hidden": "true" }, [
      el("i"), el("i"), el("i"),
    ]);
    const meter = el("div", { class: "meter", "aria-hidden": "true" }, [el("span")]);
    const shadowBtn = el("button", { class: "btn" }, ["跟读三遍"]);
    shadowBtn.addEventListener("click", async () => {
      if (shadowBtn.dataset.running === "1") {
        bus.stop();
        return;
      }
      shadowBtn.dataset.running = "1";
      shadowBtn.textContent = "停止";
      const result = await shadowLoop(line.words.map((word) => word.jyut).join(" "), "yue", 0.82, status, dots, meter);
      if (!shadowBtn.isConnected) return;
      shadowBtn.dataset.running = "0";
      shadowBtn.textContent = "跟读三遍";
      if (result === "silent") status.textContent = "粤拼录音没有播出来。请联网后再听。也可以看着标音，自己跟三遍。";
      if (result === "done") status.textContent = "三遍跟完了。可以再点开下面的词。";
    });
    const stage = el("div", { class: "chant__stage" }, [
      el("p", { class: "eyebrow" }, [CHANT.title]),
      el("p", { class: "sentence", lang: "yue" }, [line.text]),
      el("p", { class: "gloss" }, [line.gloss]),
      el("p", { class: "focus" }, [line.focus]),
      el("div", { class: "words" }, line.words.map((word) => el("button", {
        class: "word",
        onClick(event) {
          withPlaying(event.currentTarget, (gen) => bus.playJyutping(word.jyut, 0.78, gen));
        },
      }, [
        el("span", { class: "word__t", lang: "yue" }, [word.text]),
        jyutEl(word.jyut),
        el("span", {}, [word.gloss]),
      ]))),
      dots,
      meter,
      status,
      el("div", { class: "transport" }, [
        el("button", {
          class: "btn btn--solid",
          onClick(event) { withPlaying(event.currentTarget, (gen) => bus.playJyutping(line.words.map((word) => word.jyut).join(" "), 0.84, gen)); },
        }, [playIcon(), "听整句"]),
        el("button", {
          class: "btn",
          onClick(event) { withPlaying(event.currentTarget, (gen) => bus.playJyutping(line.words.map((word) => word.jyut).join(" "), 0.62, gen)); },
        }, ["慢速"]),
        shadowBtn,
      ]),
      el("p", { class: "fine" }, [CHANT.credit]),
    ]);
    root.replaceChildren(el("div", { class: "chant" }, [list, stage]));
  }

  async function shadowLoop(text, lang, rate, status, dots, meter) {
    const gen = bus.stop();
    for (let index = 0; index < 3; index += 1) {
      if (gen !== bus.gen) return "cancelled";
      setDots(dots, index, "listen");
      status.textContent = "第 " + (index + 1) + " 遍 · 听";
      meter.classList.remove("is-run");
      const ok = lang === "yue"
      ? await bus.playJyutping(text, rate, gen)
      : await bus.speak(text, lang, rate, gen);
      if (gen !== bus.gen) return "cancelled";
      if (!ok) return "silent";
      setDots(dots, index, "you");
      status.textContent = "第 " + (index + 1) + " 遍 · 轮到你";
      meter.classList.remove("is-run");
      void meter.offsetWidth;
      meter.classList.add("is-run");
      const still = await wait(SHADOW_MS, gen);
      if (!still) return "cancelled";
      setDots(dots, index, "done");
    }
    return "done";
  }

  function setDots(dots, index, state) {
    [...dots.children].forEach((dot, dotIndex) => {
      dot.classList.toggle("is-now", state !== "done" && dotIndex === index);
      dot.classList.toggle("is-done", dotIndex < index || (dotIndex === index && state === "done"));
    });
  }

  function freshProgress(sceneId) {
    return {
      sceneId: sceneId || "slower",
      step: 0,
      heard: false,
      shadowed: false,
      matched: [],
      helped: [],
      misses: {},
      meaningOrder: null,
      finished: false,
    };
  }

  function hydrate(sceneId, raw) {
    const base = freshProgress(sceneId);
    if (!raw || typeof raw !== "object") return base;
    const next = Object.assign(base, raw);
    next.sceneId = sceneId;
    next.misses = raw.misses || {};
    next.matched = Array.isArray(raw.matched) ? raw.matched : [];
    next.helped = Array.isArray(raw.helped) ? raw.helped : [];
    next.step = Math.min(6, Math.max(0, next.step | 0));
    return next;
  }

  function loadProgress() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (raw && raw.scenes) book = raw;
    } catch (err) { /* ignore */ }
    const id = book.current || "slower";
    return hydrate(id, book.scenes[id]);
  }

  function save() {
    book.current = progress.sceneId;
    book.scenes[progress.sceneId] = progress;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(book)); } catch (err) { /* ignore */ }
  }

  function openScene(id, scroll) {
    if (progress.sceneId !== id) {
      book.scenes[progress.sceneId] = progress;
      progress = hydrate(id, book.scenes[id]);
      view = progress.finished ? 6 : progress.step;
      armedMeaning = null;
      heardChips = new Set();
      lastFeedback = "";
      save();
    }
    sceneId = id;
    renderTransfer();
    renderPractice();
    if (scroll) {
      const target = document.getElementById("practice");
      if (target) target.scrollIntoView({ behavior: "smooth" });
    }
  }

  function practiceSentence() {
    return SENTENCES.find((item) => item.id === progress.sceneId) || SENTENCES[0];
  }

  function yueLang() {
    return practiceSentence().langs[0];
  }

  function yuePhrase(lang) {
    return lang.words.map((word) => word.read).join(" ");
  }

  function renderPractice() {
    const root = document.getElementById("practiceRoot");
    const picker = el("div", { class: "tabs", role: "tablist", "aria-label": "选择一句" });
    SENTENCES.forEach((scene) => {
      picker.append(el("button", {
        class: "tab",
        role: "tab",
        "aria-selected": scene.id === progress.sceneId ? "true" : "false",
        onClick() { openScene(scene.id, false); },
      }, [scene.tab]));
    });
    const nav = el("nav", { class: "steplist", "aria-label": "练习步骤" });
    STEPS.forEach((step, index) => {
      const done = index < progress.step || progress.finished;
      const locked = index > progress.step;
      const button = el("button", {
        class: "stepbtn" + (index === view ? " is-on" : ""),
        disabled: locked,
        onClick() { gotoStep(index); },
      }, [
        el("small", {}, [step.kicker]),
        el("span", {}, [step.label]),
      ]);
      if (done && index !== view) button.append(el("span", { class: "done-mark" }, ["完成"]));
      nav.append(button);
    });
    const panel = view >= 6 ? renderDone() : renderStep(STEPS[view]);
    root.replaceChildren(picker, el("div", { class: "practice" }, [nav, panel]));
    const title = document.getElementById("panelTitle");
    if (title && document.activeElement && document.activeElement.classList.contains("stepbtn")) {
      title.focus();
    }
  }

  function gotoStep(step) {
    if (step > progress.step) return;
    bus.stop();
    view = step;
    renderPractice();
  }

  function advance() {
    progress.step = Math.max(progress.step, view + 1);
    progress.finished = progress.step >= 6;
    view = Math.min(6, view + 1);
    save();
    window.setTimeout(() => {
      renderPractice();
      const title = document.getElementById("panelTitle");
      if (title) title.focus();
    }, 0);
  }

  function renderStep(step) {
    if (step.id === "listen") return renderListen();
    if (step.id === "meaning") return renderMeaning();
    if (step.id === "shadow") return renderShadow();
    if (step.id === "map") return renderMap();
    return renderTransferStep(step.id);
  }

  function panelShell(step, nodes) {
    return el("div", { class: "panel" }, [
      el("p", { class: "eyebrow" }, ["第 " + (view + 1) + " 步 · " + step.kicker]),
      el("h3", { id: "panelTitle", tabindex: "-1" }, [step.title]),
    ].concat(nodes));
  }

  function renderListen() {
    const sentence = yueLang();
    const hint = el("p", { class: "feedback", "aria-live": "polite" }, [
      progress.heard ? "你听过这句。" + practiceSentence().cue + "还可以再听，也可以看意思。" : "先听声音。" + practiceSentence().cue,
    ]);
    const count = el("p", { class: "fine" }, [""]);
    let plays = 0;
    const next = el("button", {
      class: "btn btn--solid",
      hidden: !progress.heard,
      onClick() { advance(); },
    }, ["看它的意思"]);
    const listen = el("button", { class: "btn btn--solid" }, [playIcon(), "播放粤语"]);
    listen.addEventListener("click", async () => {
      const ok = await withPlaying(listen, (gen) => bus.playJyutping(yuePhrase(sentence), 0.82, gen));
      plays += 1;
      count.textContent = "已听 " + plays + " 次";
      progress.heard = true;
      save();
      next.hidden = false;
      hint.textContent = ok
        ? practiceSentence().cue + "还可以再听一遍。"
        : "粤拼录音没有播出来。请联网后再听。你可以先看意思。";
    });
    return panelShell(STEPS[0], [
      el("p", {}, ["不用听清每个音。听两遍就够。"]),
      el("div", { class: "inline-actions" }, [
        listen,
        el("button", {
          class: "btn",
          onClick(event) {
            withPlaying(event.currentTarget, async (gen) => {
              const ok = await bus.playJyutping(yuePhrase(sentence), 0.62, gen);
              if (!ok) hint.textContent = "粤拼录音没有播出来。请联网后再听。";
              else {
                progress.heard = true;
                save();
                next.hidden = false;
              }
            });
          },
        }, ["慢速"]),
      ]),
      count,
      hint,
      next,
    ]);
  }

  function renderMeaning() {
    return panelShell(STEPS[1], [
      el("p", {}, ["意思先落定。字的读音下一步才出现。"]),
      el("p", { class: "sentence" }, [practiceSentence().gloss]),
      el("div", { class: "inline-actions" }, [
        el("button", {
          class: "btn",
          onClick(event) { withPlaying(event.currentTarget, (gen) => bus.playJyutping(yuePhrase(yueLang()), 0.82, gen)); },
        }, [playIcon(), "再听粤语"]),
      ]),
      el("p", { class: "fine" }, [practiceSentence().why]),
      el("button", { class: "btn btn--solid", onClick: advance }, ["去跟读"]),
    ]);
  }

  function renderShadow() {
    const status = el("p", { class: "status", "aria-live": "polite" }, [
      progress.shadowed ? "你跟过这句。可以再来三遍，也可以去对词。" : "张嘴。跟着高低和快慢走，不用每个声母都准。",
    ]);
    const dots = el("div", { class: "dots", "aria-hidden": "true" }, [el("i"), el("i"), el("i")]);
    const meter = el("div", { class: "meter" }, [el("span")]);
    const next = el("button", {
      class: "btn btn--solid",
      hidden: !progress.shadowed,
      onClick: advance,
    }, ["去把词对上"]);
    const shadowBtn = el("button", { class: "btn btn--solid" }, ["跟读三遍"]);
    shadowBtn.addEventListener("click", async () => {
      if (shadowBtn.dataset.running === "1") {
        bus.stop();
        return;
      }
      shadowBtn.dataset.running = "1";
      shadowBtn.textContent = "停止";
      const result = await shadowLoop(yuePhrase(yueLang()), "yue", 0.82, status, dots, meter);
      if (result === "cancelled") {
        if (shadowBtn.isConnected) {
          shadowBtn.dataset.running = "0";
          shadowBtn.textContent = "跟读三遍";
        }
        return;
      }
      progress.shadowed = true;
      save();
      renderPractice();
    });
    return panelShell(STEPS[2], [
      el("p", { class: "sentence", lang: "yue" }, [yueLang().text]),
      el("p", { class: "gloss" }, [practiceSentence().gloss]),
      dots,
      meter,
      status,
      el("div", { class: "inline-actions" }, [shadowBtn, next]),
    ]);
  }

  function renderMap() {
    const lang = yueLang();
    const ids = lang.words.map((word) => word.id);
    if (!Array.isArray(progress.meaningOrder) || progress.meaningOrder.length !== ids.length || !ids.every((id) => progress.meaningOrder.includes(id))) {
      progress.meaningOrder = shuffle(ids);
      save();
    }
    const byId = Object.fromEntries(lang.words.map((word) => [word.id, word]));
    const matched = new Set(progress.matched);
    const feedback = el("p", { class: "feedback", "aria-live": "polite" }, [
      lastFeedback || "先点一个意思，再点它对应的声音。也可以先点喇叭。",
    ]);
    const meaningRow = el("div", { class: "meanings" });
    progress.meaningOrder.forEach((id) => {
      const word = byId[id];
      meaningRow.append(el("button", {
        class: "meaning",
        "data-role": "meaning",
        "data-id": id,
        "aria-pressed": armedMeaning === id ? "true" : "false",
        disabled: matched.has(id),
      }, [matched.has(id) ? word.gloss + " · 已对上" : word.gloss]));
    });
    const soundRow = el("div", { class: "sounds" });
    lang.words.forEach((word) => {
      const showRead = heardChips.has(word.id) || matched.has(word.id);
      const box = el("div", {
        class: "sound" + (matched.has(word.id) ? " is-matched" : ""),
        "data-id": word.id,
      }, [
        el("button", { class: "iconbtn", "data-role": "play", "aria-label": "听 " + word.text }, [playIcon()]),
        el("button", { class: "sound__hit", "data-role": "hit" }, [
          el("span", { class: "sound__text", lang: "yue" }, [word.text]),
          showRead ? jyutEl(word.read) : el("span", { class: "fine" }, ["点喇叭后出现读音"]),
          matched.has(word.id) ? el("span", {}, [word.gloss + (progress.helped.includes(word.id) ? " · 先记住" : "")]) : null,
        ]),
      ]);
      soundRow.append(box);
    });
    const panel = panelShell(STEPS[3], [
      el("p", {}, ["四个意思，四块声音。对上以后，每一块都可以单独再听。"]),
      el("p", { class: "sentence", lang: "yue" }, [lang.text]),
      meaningRow,
      soundRow,
      feedback,
      el("p", { class: "fine" }, ["已对上 " + matched.size + " / " + lang.words.length]),
      el("button", {
        class: "btn btn--solid",
        hidden: matched.size < lang.words.length,
        onClick: advance,
      }, ["换成英语"]),
    ]);
    panel.addEventListener("click", (event) => {
      const play = event.target.closest("[data-role='play']");
      const hit = event.target.closest("[data-role='hit']");
      const meaning = event.target.closest("[data-role='meaning']");
      if (meaning) {
        armedMeaning = armedMeaning === meaning.dataset.id ? null : meaning.dataset.id;
        lastFeedback = armedMeaning ? "已选「" + byId[meaning.dataset.id].gloss + "」。点下面的声音。" : "先点一个意思，再点它对应的声音。";
        window.setTimeout(renderPractice, 0);
        return;
      }
      const sound = (play || hit) && (play || hit).closest(".sound");
      if (!sound) return;
      const word = byId[sound.dataset.id];
      if (play) {
        heardChips.add(word.id);
        withPlaying(play, (gen) => bus.playJyutping(word.read, 0.76, gen));
        const hitBtn = sound.querySelector(".sound__hit");
        const read = hitBtn.querySelector(".jyut");
        if (!read) {
          const placeholder = hitBtn.querySelector(".fine");
          if (placeholder) placeholder.replaceWith(jyutEl(word.read));
        }
        return;
      }
      if (!armedMeaning) {
        heardChips.add(word.id);
        withPlaying(hit, (gen) => bus.playJyutping(word.read, 0.76, gen));
        window.setTimeout(renderPractice, 0);
        return;
      }
      if (matched.has(word.id)) return;
      if (armedMeaning === word.id) {
        if (!progress.matched.includes(word.id)) progress.matched.push(word.id);
        armedMeaning = null;
        lastFeedback = "对上了。" + word.text + "，就是「" + word.gloss + "」。" + word.note;
        save();
        window.setTimeout(renderPractice, 0);
        return;
      }
      progress.misses[armedMeaning] = (progress.misses[armedMeaning] || 0) + 1;
      const target = byId[armedMeaning];
      heardChips.add(word.id);
      sound.classList.add("is-wrong");
      withPlaying(hit, (gen) => bus.playJyutping(word.read, 0.76, gen));
      if (progress.misses[armedMeaning] >= 2) {
        if (!progress.matched.includes(armedMeaning)) progress.matched.push(armedMeaning);
        if (!progress.helped.includes(armedMeaning)) progress.helped.push(armedMeaning);
        lastFeedback = "这一块先替你对上：" + target.text + " 就是「" + target.gloss + "」。" + target.note;
        armedMeaning = null;
        save();
        window.setTimeout(renderPractice, 0);
        return;
      }
      save();
      feedback.textContent = "对不上「" + target.gloss + "」。再听一次你点的这块。";
    });
    return panel;
  }

  function renderTransferStep(id) {
    const lang = practiceSentence().langs.find((item) => item.id === id);
    const step = STEPS.find((item) => item.id === id);
    const status = el("p", { class: "status", "aria-live": "polite" }, ["先听一遍，再跟一次。"]);
    const meter = el("div", { class: "meter" }, [el("span")]);
    return panelShell(step, [
      el("p", { class: "gloss" }, [practiceSentence().gloss]),
      el("p", { class: "sentence", lang: id === "ja" ? "ja" : "en" }, [lang.text]),
      el("p", { class: "hear" }, [lang.hear]),
      meter,
      status,
      el("div", { class: "inline-actions" }, [
        el("button", {
          class: "btn btn--solid",
          onClick(event) { withPlaying(event.currentTarget, (gen) => bus.speak(lang.text, lang.code, lang.rate, gen)); },
        }, [playIcon(), "听这句"]),
        el("button", {
          class: "btn",
          onClick: async (event) => {
            const button = event.currentTarget;
            const gen = bus.stop();
            button.classList.add("is-playing");
            button.dataset.playGen = String(gen);
            status.textContent = "听";
            const ok = await bus.speak(lang.text, lang.code, lang.rate, gen);
            if (gen !== bus.gen) return;
            button.classList.remove("is-playing");
            if (!ok) {
              status.textContent = lang.id === "ja"
                ? "日语没有播出来。请联网后再试。"
                : "这只浏览器没有" + lang.label + "语音。看着字，小声跟一次。";
              return;
            }
            status.textContent = "轮到你";
            meter.classList.remove("is-run");
            void meter.offsetWidth;
            meter.classList.add("is-run");
            const still = await wait(SHADOW_MS, gen);
            if (!still) return;
            status.textContent = "这一遍跟完了。";
          },
        }, ["跟一次"]),
      ]),
      el("div", { class: "words" }, lang.words.map((word) => el("button", {
        class: "word",
        onClick(event) { withPlaying(event.currentTarget, (gen) => bus.speak(word.text, lang.code, Math.max(0.72, lang.rate - 0.08), gen)); },
      }, [
        el("span", { class: "word__t" + (word.stress ? " stress" : ""), lang: id === "ja" ? "ja" : "en" }, [word.text]),
        el("span", { class: "read" }, [word.read]),
        el("span", {}, [word.gloss]),
        el("span", { class: "fine" }, [word.note]),
      ]))),
      el("p", { class: "block" }, [lang.block]),
      el("button", { class: "btn btn--solid", onClick: advance }, [id === "en" ? "换成日语" : "走完这一遍"]),
    ]);
  }

  function renderDone() {
    const helped = progress.helped.length
      ? el("p", { class: "fine" }, ["有的词是先记住再听会的。再点一次喇叭，让嘴巴跟上。"])
      : null;
    return el("div", { class: "panel" }, [
      el("p", { class: "eyebrow" }, ["走通了"]),
      el("h3", { id: "panelTitle", tabindex: "-1" }, ["这句你已经走完了。"]),
      el("p", {}, ["例子、模仿、对应，你刚刚各做了一次。英语多听了重音，日语多听了拍子。方法没有换。"]),
      helped,
      el("p", {}, ["下面把三种语言放在一起听，还有一句用来把「不敢说」说出来。"]),
      el("div", { class: "inline-actions" }, [
        el("a", { class: "btn btn--solid", href: "#transfer" }, ["去对照三种语言"]),
        el("button", {
          class: "btn",
          onClick() {
            progress = freshProgress(progress.sceneId);
            view = 0;
            armedMeaning = null;
            heardChips = new Set();
            lastFeedback = "";
            save();
            renderPractice();
          },
        }, ["再走一遍"]),
      ]),
    ]);
  }

  function shuffle(list) {
    const copy = list.slice();
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      const hold = copy[index];
      copy[index] = copy[swap];
      copy[swap] = hold;
    }
    return copy;
  }

  function renderTransfer() {
    const root = document.getElementById("transferRoot");
    const tabs = el("div", { class: "tabs", role: "tablist" });
    SENTENCES.forEach((scene) => {
      tabs.append(el("button", {
        class: "tab",
        role: "tab",
        "aria-selected": scene.id === sceneId ? "true" : "false",
        onClick() {
          sceneId = scene.id;
          renderTransfer();
        },
      }, [scene.tab]));
    });
    const scene = SENTENCES.find((item) => item.id === sceneId);
    const status = el("p", { class: "status", id: "sceneStatus", "aria-live": "polite" }, ["可以三种连着听，也可以点开一块。"]);
    const allBtn = el("button", { class: "btn btn--solid" }, ["三种依次听"]);
    allBtn.addEventListener("click", () => {
      withPlaying(allBtn, async (gen) => {
        for (const lang of scene.langs) {
          if (gen !== bus.gen) return;
          status.textContent = "正在听" + lang.label;
          const col = document.getElementById("col-" + scene.id + "-" + lang.id);
          if (col) col.classList.add("is-hot");
          const ok = lang.id === "yue"
            ? await bus.playJyutping(yuePhrase(lang), lang.rate, gen)
            : await bus.speak(lang.text, lang.code, lang.rate, gen);
          if (col) col.classList.remove("is-hot");
          if (gen !== bus.gen) return;
          if (!ok) status.textContent = lang.id === "ja"
            ? "日语没有播出来。请联网后再试。"
            : lang.label + "没有可用的语音，继续下一种。";
          const still = await wait(380, gen);
          if (!still) return;
        }
        if (gen === bus.gen) status.textContent = "三种都过了一遍。点开词，可以单独听一块。";
      });
    });
    const cols = el("div", { class: "cols" });
    scene.langs.forEach((lang) => {
      cols.append(el("article", { class: "col col--" + lang.id, id: "col-" + scene.id + "-" + lang.id }, [
        el("h3", {}, [lang.label]),
        el("p", { class: "sentence", lang: lang.id === "yue" ? "yue" : lang.id === "ja" ? "ja" : "en" }, [lang.text]),
        el("button", {
          class: "btn btn--small",
          onClick(event) {
            withPlaying(event.currentTarget, async (gen) => {
              const ok = lang.id === "yue"
                ? await bus.playJyutping(yuePhrase(lang), lang.rate, gen)
                : await bus.speak(lang.text, lang.code, lang.rate, gen);
              if (!ok && gen === bus.gen && lang.id === "ja") {
                const note = document.getElementById("sceneStatus");
                if (note) note.textContent = "日语没有播出来。请联网后再试。";
              }
            });
          },
        }, [playIcon(), "听" + lang.label]),
        el("p", { class: "hear" }, [lang.hear]),
        el("p", { class: "block" }, [el("strong", {}, ["整块记。 "]), lang.block]),
        el("div", { class: "words" }, lang.words.map((word) => el("button", {
          class: "word",
          onClick(event) {
            withPlaying(event.currentTarget, (gen) => (
              lang.id === "yue"
                ? bus.playJyutping(word.read, Math.max(0.72, lang.rate - 0.08), gen)
                : bus.speak(word.text, lang.code, Math.max(0.72, lang.rate - 0.08), gen)
            ));
          },
        }, [
          el("span", { class: "word__t" + (word.stress ? " stress" : "") }, [word.text]),
          lang.id === "yue" ? jyutEl(word.read) : el("span", { class: "read" }, [word.read]),
          el("span", {}, [word.gloss]),
        ]))),
      ]));
    });
    root.replaceChildren(el("div", {}, [
      tabs,
      el("h3", {}, [scene.title]),
      el("p", { class: "lede" }, [scene.why]),
      el("p", { class: "gloss" }, [scene.gloss]),
      el("div", { class: "inline-actions" }, [
        allBtn,
        el("button", {
          class: "btn",
          onClick() { openScene(scene.id, true); },
        }, ["拿这句去练习"]),
      ]),
      status,
      cols,
    ]));
  }

  function bindStaticSpeech() {
    document.body.addEventListener("click", (event) => {
      const button = event.target.closest("[data-speak], [data-speak-seq], [data-read], [data-read-seq]");
      if (!button) return;
      const lang = button.dataset.lang || "zh-HK";
      const rate = Number(button.dataset.rate || (lang === "zh-HK" ? 0.82 : 0.9));
      withPlaying(button, async (gen) => {
        if (button.dataset.read || button.dataset.readSeq) {
          const reads = button.dataset.readSeq ? button.dataset.readSeq.split("|") : [button.dataset.read];
          for (let index = 0; index < reads.length; index += 1) {
            const ok = await bus.playJyutping(reads[index], rate, gen);
            if (!ok || gen !== bus.gen) return;
            if (index < reads.length - 1) {
              const still = await wait(420, gen);
              if (!still) return;
            }
          }
          return;
        }
        const parts = button.dataset.speakSeq ? button.dataset.speakSeq.split("|") : [button.dataset.speak];
        for (let index = 0; index < parts.length; index += 1) {
          const ok = await bus.speak(parts[index], lang, rate, gen);
          if (!ok || gen !== bus.gen) return;
          if (index < parts.length - 1) {
            const still = await wait(420, gen);
            if (!still) return;
          }
        }
      });
    });
  }

  function bindNav() {
    const links = [...document.querySelectorAll(".nav a")];
    const sections = links.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((link) => {
          const on = link.getAttribute("href") === "#" + entry.target.id;
          if (on) link.setAttribute("aria-current", "true");
          else link.removeAttribute("aria-current");
        });
      });
    }, { rootMargin: "-40% 0px -50% 0px", threshold: 0.01 });
    sections.forEach((section) => observer.observe(section));
  }

  function renderSoundShelf(rootId, items, play) {
    const root = document.getElementById(rootId);
    if (!root) return;
    const grid = el("div", { class: rootId === "bitRoot" || rootId === "jaBitRoot" ? "bitgrid" : "pairgrid" });
    items.forEach((item) => {
      if (item.a) {
        grid.append(el("article", { class: "pair" }, [
          el("h3", {}, [item.title]),
          el("p", { class: "fine" }, [item.note]),
          el("div", { class: "inline-actions" }, [
            el("button", { class: "btn btn--small", onClick(event) { withPlaying(event.currentTarget, (gen) => play(item.a, gen)); } }, [playIcon(), item.a.gloss]),
            el("button", { class: "btn btn--small", onClick(event) { withPlaying(event.currentTarget, (gen) => play(item.b, gen)); } }, [playIcon(), item.b.gloss]),
          ]),
          el("p", {}, [jyutEl(item.a.jyut), " · ", jyutEl(item.b.jyut)]),
        ]));
      } else {
        grid.append(el("article", { class: "bit" }, [
          el("h3", { lang: item.jyut ? "yue" : "ja" }, [item.text]),
          item.jyut ? jyutEl(item.jyut) : el("p", { class: "read" }, [item.read]),
          el("p", {}, [item.gloss]),
          el("p", { class: "fine" }, [item.note]),
          el("button", {
            class: "btn btn--small",
            onClick(event) { withPlaying(event.currentTarget, (gen) => play(item, gen)); },
          }, [playIcon(), "听"]),
        ]));
      }
    });
    root.replaceChildren(grid);
  }

  function init() {
    decorateJyut(document);
    renderHero();
    renderMirror();
    renderSoundShelf("pairRoot", TONE_PAIRS, (item, gen) => bus.playJyutping(item.jyut, 0.8, gen));
    renderSoundShelf("bitRoot", BITS, (item, gen) => bus.playJyutping(item.jyut, 0.8, gen));
    renderSoundShelf("jaBitRoot", JA_BITS, (item, gen) => bus.speak(item.text, "ja-JP", 0.86, gen));
    renderChant();
    renderPractice();
    renderTransfer();
    bindStaticSpeech();
    bindNav();
    if (canSpeak()) {
      speechSynthesis.addEventListener("voiceschanged", setVoiceStatus);
      setVoiceStatus();
      window.setTimeout(setVoiceStatus, 700);
    } else {
      setVoiceStatus();
    }
  }

  init();
})();
