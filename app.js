(function () {
  "use strict";

  const DATA = window.CF763_DATA;
  const TTS = window.CF763TTS;

  if (!DATA || !DATA.terms) {
    document.body.innerHTML = "<p style='padding:24px'>無法載入術語資料庫 (data/terms_data.js)。</p>";
    return;
  }

  const CAT_MAP = new Map(DATA.categories.map((c) => [c.id, c]));
  const STORAGE_KEY = "cf763_mastery_v1";

  // State
  let masteryMap = {};
  try {
    masteryMap = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch (_) {
    masteryMap = {};
  }

  let currentView = "mindmap";
  let mindmap = null;

  // Browse & continuous playback state
  let browseFiltered = [];
  let browsePage = 1;
  const PAGE_SIZE = 60;
  let isPlaying = false;
  let playIndex = 0;
  let playRunId = 0;
  let speakingTermId = null;

  // Flashcard state
  let fcDeck = [];
  let fcIndex = 0;
  let fcFlipped = false;

  // Quiz state
  let qzPool = [];
  let qzCurrent = null;
  let qzAnswered = false;
  let qzCorrect = 0;
  let qzTotal = 0;

  function esc(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getMastery(id) {
    return masteryMap[id] || "new";
  }

  function setMastery(id, status) {
    if (status === "new") {
      delete masteryMap[id];
    } else {
      masteryMap[id] = status;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(masteryMap));
    updateBrandStats();
  }

  function updateBrandStats() {
    const total = DATA.terms.length;
    const mastered = Object.values(masteryMap).filter((v) => v === "mastered").length;
    const review = Object.values(masteryMap).filter((v) => v === "review").length;
    document.getElementById("brandStats").textContent =
      `共 ${total.toLocaleString()} 詞・${DATA.categories.length} 大分類｜已熟記 ${mastered}・待複習 ${review}`;
  }

  // ========== VOICE SETTINGS & STATUS ==========
  function initVoiceUI() {
    const selJa = document.getElementById("selJaVoice");
    const selZh = document.getElementById("selZhVoice");
    const rngRate = document.getElementById("rngRate");
    const lblRate = document.getElementById("lblRate");
    const pill = document.getElementById("ttsStatusPill");
    const statusText = document.getElementById("ttsStatusText");
    const detailHint = document.getElementById("voiceDetailHint");

    selJa.value = TTS.jaVoice;
    selZh.value = TTS.zhVoice;
    rngRate.value = TTS.rate;
    lblRate.textContent = `${TTS.rate.toFixed(2)}x`;

    const renderStatus = (st) => {
      statusText.textContent = st.label;
      pill.title = st.detail;
      detailHint.textContent = st.detail;
      pill.classList.remove("warn", "err");
      if (st.mode === "webspeech-ms") pill.classList.add("warn");
      if (st.mode === "no-ms-voice") pill.classList.add("err");
    };
    TTS.onStatusChange = renderStatus;
    renderStatus(TTS.getStatus());

    selJa.addEventListener("change", () => TTS.setVoices(selJa.value, selZh.value));
    selZh.addEventListener("change", () => TTS.setVoices(selJa.value, selZh.value));
    rngRate.addEventListener("input", () => {
      const r = parseFloat(rngRate.value);
      lblRate.textContent = `${r.toFixed(2)}x`;
      TTS.setRate(r);
    });

    document.getElementById("btnToggleVoiceBar").addEventListener("click", () => {
      document.getElementById("voiceSettingsBar").classList.toggle("hidden");
    });

    document.getElementById("btnTestVoice").addEventListener("click", async () => {
      try {
        await TTS.speakSequence(
          [
            { text: "シールドマシン、受変電設備", lang: "ja", audioPath: "audio/test_ja.mp3" },
            { text: "潛盾機、受變電設備，微軟真人語音測試正常", lang: "zh", audioPath: "audio/test_zh.mp3" },
          ],
          500
        );
      } catch (err) {
        alert(err.message || String(err));
      }
    });
  }

  // ========== THEME ==========
  function initTheme() {
    const btn = document.getElementById("btnToggleTheme");
    const saved = localStorage.getItem("cf763_theme");
    if (saved === "dark") {
      document.body.classList.add("dark");
      btn.textContent = "☀️";
    }
    btn.addEventListener("click", () => {
      const isDark = document.body.classList.toggle("dark");
      btn.textContent = isDark ? "☀️" : "🌙";
      localStorage.setItem("cf763_theme", isDark ? "dark" : "light");
    });
  }

  // ========== NAVIGATION ==========
  function switchView(viewName) {
    currentView = viewName;
    document.querySelectorAll(".nav-tab").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === viewName);
    });
    document.querySelectorAll(".view-section").forEach((sec) => {
      sec.classList.toggle("active", sec.id === `view-${viewName}`);
    });
    if (viewName === "mindmap" && mindmap) {
      setTimeout(() => mindmap.fitToView(), 40);
    }
    if (viewName === "flashcard" && fcDeck.length === 0) {
      buildFlashcardDeck();
    }
    if (viewName === "quiz" && !qzCurrent) {
      startQuizQuestion();
    }
  }

  document.querySelectorAll(".nav-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  // ========== HELPER: SPEAK TERM ==========
  async function speakSingleTerm(term, mode = "jp-zh") {
    stopContinuousPlay();
    const steps = buildSpeakSteps(term, mode);
    try {
      await TTS.speakSequence(steps, 650);
    } catch (err) {
      alert(err.message || String(err));
    }
  }

  function buildSpeakSteps(term, mode) {
    const jpStep = { text: term.jp || term.kana, lang: "ja", audioPath: `audio/ja/${term.id}.mp3` };
    const zhStep = { text: term.zh, lang: "zh", audioPath: `audio/zh/${term.id}.mp3` };
    if (mode === "jp") return [jpStep];
    if (mode === "zh") return [zhStep];
    if (mode === "zh-jp") return [zhStep, jpStep];
    if (mode === "jp2-zh") return [jpStep, jpStep, zhStep];
    return [jpStep, zhStep];
  }

  // ========== VIEW 1: MIND MAP ==========
  function initMindMap() {
    const canvas = document.getElementById("mindmapCanvas");
    mindmap = new window.CF763MindMap(canvas, {
      data: DATA,
      getMastery,
      onSelectNode: renderInspector,
      onSpeakTerm: (term) => speakSingleTerm(term, "jp-zh"),
    });

    // Default inspector shows root overview
    renderInspector({ type: "root", totalFiltered: DATA.terms.length });

    const mmSearch = document.getElementById("mmSearch");
    let searchTimer = null;
    mmSearch.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        mindmap.setSearch(mmSearch.value);
      }, 180);
    });

    document.querySelectorAll("#mmFilterGroup .seg-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#mmFilterGroup .seg-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        mindmap.setFilter(btn.dataset.filter);
      });
    });

    document.querySelectorAll("#mmLayoutGroup .seg-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#mmLayoutGroup .seg-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        mindmap.setLayout(btn.dataset.layout);
      });
    });

    document.getElementById("btnMmExpandAll").addEventListener("click", () => mindmap.expandAllCategories());
    document.getElementById("btnMmCollapseAll").addEventListener("click", () => mindmap.collapseAll());
    document.getElementById("btnMmFit").addEventListener("click", () => mindmap.fitToView());
    document.getElementById("btnMmZoomIn").addEventListener("click", () => mindmap.zoomBy(1.2));
    document.getElementById("btnMmZoomOut").addEventListener("click", () => mindmap.zoomBy(0.83));
  }

  function renderInspector(info) {
    const panel = document.getElementById("mmInspector");
    if (!info || info.type === "root") {
      const catListHtml = DATA.categories
        .map((c) => {
          const mastered = DATA.terms.filter((t) => t.cat === c.id && getMastery(t.id) === "mastered").length;
          return `
            <div class="cat-quick-item" data-cat="${esc(c.id)}">
              <div style="display:flex;align-items:center;min-width:0;">
                <span class="cat-dot" style="background:${c.color}"></span>
                <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"><strong>${esc(c.code)}</strong> ${esc(c.name)}</span>
              </div>
              <span style="color:var(--text-soft);font-size:11.5px;flex-shrink:0;">${c.count} 詞 (${mastered} 熟)</span>
            </div>`;
        })
        .join("");

      panel.innerHTML = `
        <div>
          <span class="insp-badge">17 大專業領域・分門別類</span>
          <div class="insp-title">CF763 工程術語心智圖</div>
          <div style="font-size:12.5px;color:var(--text-soft);line-height:1.5;">
            點擊左側心智圖或下方任一分類，即可逐層展開「主分類 → 子專項 → 術語節點」，並一鍵啟動該分類的連續朗讀或閃卡複習。
          </div>
        </div>
        <div class="cat-quick-list">${catListHtml}</div>
      `;

      panel.querySelectorAll(".cat-quick-item").forEach((item) => {
        item.addEventListener("click", () => mindmap.focusCategory(item.dataset.cat));
      });
      return;
    }

    if (info.type === "category" || info.type === "subcategory") {
      const cat = info.category;
      const terms = info.terms || [];
      const isSub = info.type === "subcategory";
      const mastered = terms.filter((t) => getMastery(t.id) === "mastered").length;
      const aCount = terms.filter((t) => t.imp === "A").length;
      const sampleHtml = terms
        .slice(0, 18)
        .map(
          (t) => `
          <div class="cat-quick-item" data-term-id="${t.id}">
            <div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              <strong>${esc(t.jp)}</strong>
              <span style="color:var(--primary);margin-left:6px;">${esc(t.zh)}</span>
            </div>
            <button class="mini-btn" data-speak-id="${t.id}" title="朗讀">🔊</button>
          </div>`
        )
        .join("");

      panel.innerHTML = `
        <div>
          <span class="insp-badge" style="background:${cat.color}20;color:${cat.color}">
            ${esc(cat.code)} ${esc(cat.name)}${isSub ? " › 子分類" : ""}
          </span>
          <div class="insp-title">${esc(isSub ? info.subName : cat.name)}</div>
          <div style="font-size:12.5px;color:var(--text-soft);line-height:1.5;">
            ${esc(cat.scope || "")}
          </div>
        </div>

        <div class="insp-block">
          <div class="insp-block-label">分類統計</div>
          術語數：<strong>${terms.length}</strong> 筆｜A 級必背：<strong>${aCount}</strong> 筆｜已熟記：<strong>${mastered}</strong> 筆
        </div>

        <div class="insp-actions">
          <button class="btn btn-primary" id="inspJumpRead">🔊 連續朗讀此分類</button>
          <button class="btn" id="inspJumpFC">🃏 閃卡複習</button>
          <button class="btn" id="inspJumpQuiz">📝 測驗此分類</button>
        </div>

        <div style="font-size:12px;font-weight:700;color:var(--text-soft);">術語速覽（前 ${Math.min(18, terms.length)} 筆）</div>
        <div class="cat-quick-list">${sampleHtml}</div>
      `;

      document.getElementById("inspJumpRead").addEventListener("click", () => {
        jumpToBrowse(cat.id, isSub ? info.subName : "", true);
      });
      document.getElementById("inspJumpFC").addEventListener("click", () => {
        document.getElementById("fcCat").value = cat.id;
        buildFlashcardDeck();
        switchView("flashcard");
      });
      document.getElementById("inspJumpQuiz").addEventListener("click", () => {
        document.getElementById("qzCat").value = cat.id;
        qzCorrect = 0;
        qzTotal = 0;
        switchView("quiz");
        startQuizQuestion();
      });

      panel.querySelectorAll("[data-speak-id]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const t = terms.find((x) => x.id === Number(btn.dataset.speakId));
          if (t) speakSingleTerm(t, "jp-zh");
        });
      });
      panel.querySelectorAll("[data-term-id]").forEach((row) => {
        row.addEventListener("click", () => {
          const t = terms.find((x) => x.id === Number(row.dataset.termId));
          if (t) renderInspector({ type: "term", term: t, category: cat });
        });
      });
      return;
    }

    if (info.type === "term") {
      const t = info.term;
      const cat = info.category || CAT_MAP.get(t.cat);
      const st = getMastery(t.id);

      panel.innerHTML = `
        <div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
            <span class="insp-badge" style="background:${cat.color}20;color:${cat.color}">${esc(cat.code)} ${esc(cat.name)}</span>
            ${t.imp ? `<span class="tag ${t.imp === "A" ? "tag-a" : "tag-b"}">重要度 ${esc(t.imp)}</span>` : ""}
            ${t.flag ? `<span class="tag tag-flag">校對：${esc(t.flag)}</span>` : ""}
          </div>
          <div class="insp-title">${esc(t.jp)}</div>
          ${t.kana ? `<div class="insp-kana">${esc(t.kana)}</div>` : ""}
          <div class="insp-zh">${esc(t.zh)}</div>
          ${t.en ? `<div class="insp-en">${esc(t.en)}</div>` : ""}
        </div>

        <div class="insp-actions">
          <button class="btn btn-primary" id="inspSpkBoth">🔊 日＋中連讀</button>
          <button class="btn" id="inspSpkJp">🇯🇵 日文</button>
          <button class="btn" id="inspSpkZh">🇹🇼 中文</button>
        </div>

        <div class="insp-actions">
          <button class="btn ${st === "review" ? "btn-warn" : ""}" id="inspMarkRev">⭐ ${st === "review" ? "已標記待複習" : "加入待複習"}</button>
          <button class="btn ${st === "mastered" ? "btn-ok" : ""}" id="inspMarkOk">✅ ${st === "mastered" ? "已熟記" : "標記已熟記"}</button>
        </div>

        ${t.usage ? `<div class="insp-block"><div class="insp-block-label">現場意味・用途</div>${esc(t.usage)}</div>` : ""}
        ${t.note ? `<div class="insp-block"><div class="insp-block-label">通訳・技術注意</div>${esc(t.note)}</div>` : ""}
        ${t.sys || t.iface ? `<div class="insp-block"><div class="insp-block-label">適用系統與介面</div>${t.sys ? `<div><strong>系統：</strong>${esc(t.sys)}</div>` : ""}${t.iface ? `<div><strong>土木／機電界面：</strong>${esc(t.iface)}</div>` : ""}</div>` : ""}
        ${t.altKana || t.altZh || t.altEn ? `<div class="insp-block"><div class="insp-block-label">異譯／異讀校對參考</div>${t.altKana ? `<div><strong>讀音異表記：</strong>${esc(t.altKana)}</div>` : ""}${t.altZh ? `<div><strong>中文異譯：</strong>${esc(t.altZh)}</div>` : ""}${t.altEn ? `<div><strong>英語異表記：</strong>${esc(t.altEn)}</div>` : ""}</div>` : ""}
        <div class="insp-block" style="font-size:11.5px;color:var(--text-soft);">
          <div class="insp-block-label">分類與來源（${t.srcCount} 份）</div>
          <div>子分類：${esc(t.sub)}</div>
          <div>來源檔案：${esc(t.srcFiles)}</div>
        </div>
      `;

      document.getElementById("inspSpkBoth").addEventListener("click", () => speakSingleTerm(t, "jp-zh"));
      document.getElementById("inspSpkJp").addEventListener("click", () => speakSingleTerm(t, "jp"));
      document.getElementById("inspSpkZh").addEventListener("click", () => speakSingleTerm(t, "zh"));
      document.getElementById("inspMarkRev").addEventListener("click", () => {
        setMastery(t.id, st === "review" ? "new" : "review");
        renderInspector(info);
        mindmap.render(false);
      });
      document.getElementById("inspMarkOk").addEventListener("click", () => {
        setMastery(t.id, st === "mastered" ? "new" : "mastered");
        renderInspector(info);
        mindmap.render(false);
      });
    }
  }

  // ========== VIEW 2: BROWSE & CONTINUOUS READ-ALOUD ==========
  function populateCategorySelects() {
    const opts = [
      `<option value="">全部 17 大分類 (${DATA.terms.length})</option>`,
      ...DATA.categories.map((c) => `<option value="${esc(c.id)}">${esc(c.code)} ${esc(c.name)} (${c.count})</option>`),
    ].join("");
    document.getElementById("selCat").innerHTML = opts;
    document.getElementById("fcCat").innerHTML = opts;
    document.getElementById("qzCat").innerHTML = opts;
    updateSubSelect();
  }

  function updateSubSelect() {
    const catId = document.getElementById("selCat").value;
    const selSub = document.getElementById("selSub");
    if (!catId) {
      selSub.innerHTML = `<option value="">全部子分類</option>`;
      return;
    }
    const cat = CAT_MAP.get(catId);
    selSub.innerHTML = [
      `<option value="">全部子分類 (${cat.subcategories.length})</option>`,
      ...cat.subcategories.map((s) => `<option value="${esc(s.name)}">${esc(s.name)} (${s.count})</option>`),
    ].join("");
  }

  function applyBrowseFilter(resetPage = true) {
    const catId = document.getElementById("selCat").value;
    const subName = document.getElementById("selSub").value;
    const imp = document.getElementById("selImp").value;
    const mFilter = document.getElementById("selMastery").value;
    const flagOnly = document.getElementById("chkFlagOnly").checked;
    const q = document.getElementById("txtSearch").value.trim().toLowerCase();

    browseFiltered = DATA.terms.filter((t) => {
      if (catId && t.cat !== catId) return false;
      if (subName && t.sub !== subName) return false;
      if (imp && t.imp !== imp) return false;
      if (flagOnly && !t.flag) return false;
      const st = getMastery(t.id);
      if (mFilter === "mastered" && st !== "mastered") return false;
      if (mFilter === "review" && st !== "review") return false;
      if (mFilter === "unmastered" && st === "mastered") return false;
      if (q) {
        const hay = `${t.jp} ${t.kana} ${t.zh} ${t.en} ${t.usage} ${t.note} ${t.sub}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (resetPage) browsePage = 1;
    document.getElementById("lblFilterCount").textContent = `篩選結果：${browseFiltered.length} 筆`;
    renderBrowseGrid();
  }

  function renderBrowseGrid() {
    const grid = document.getElementById("termsGrid");
    const totalPages = Math.max(1, Math.ceil(browseFiltered.length / PAGE_SIZE));
    browsePage = Math.max(1, Math.min(browsePage, totalPages));
    const start = (browsePage - 1) * PAGE_SIZE;
    const slice = browseFiltered.slice(start, start + PAGE_SIZE);

    if (slice.length === 0) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-soft);">沒有符合條件的術語。</div>`;
      document.getElementById("paginationBar").innerHTML = "";
      return;
    }

    grid.innerHTML = slice
      .map((t, idx) => {
        const globalIdx = start + idx;
        const cat = CAT_MAP.get(t.cat);
        const st = getMastery(t.id);
        const activeClass = speakingTermId === t.id ? "is-speaking" : "";
        return `
          <div class="term-card ${activeClass}" data-term-id="${t.id}" data-idx="${globalIdx}">
            <div class="term-card-top">
              <span style="color:${cat.color};font-weight:700;">${esc(cat.code)} ${esc(cat.name)} · ${esc(t.sub)}</span>
              <div style="display:flex;gap:4px;">
                ${t.imp ? `<span class="tag ${t.imp === "A" ? "tag-a" : "tag-b"}">${esc(t.imp)}</span>` : ""}
                ${t.flag ? `<span class="tag tag-flag">校對</span>` : ""}
              </div>
            </div>
            <div>
              <div class="term-jp">${esc(t.jp)}</div>
              ${t.kana ? `<div class="term-kana">${esc(t.kana)}</div>` : ""}
            </div>
            <div class="term-zh">${esc(t.zh)}</div>
            ${t.en ? `<div class="term-en">${esc(t.en)}</div>` : ""}
            ${t.usage ? `<div class="term-usage">${esc(t.usage)}</div>` : ""}
            <div class="term-card-foot">
              <div style="display:flex;gap:5px;">
                <button class="mini-btn" data-act="jp" title="朗讀日文">🔊 日</button>
                <button class="mini-btn" data-act="zh" title="朗讀中文">🔊 中</button>
                <button class="mini-btn" data-act="playFrom" title="從此詞開始連續朗讀">▶ 從此連讀</button>
              </div>
              <div style="display:flex;gap:5px;">
                <button class="mini-btn ${st === "review" ? "active-warn" : ""}" data-act="review">⭐ 待複習</button>
                <button class="mini-btn ${st === "mastered" ? "active-ok" : ""}" data-act="mastered">✅ 熟記</button>
              </div>
            </div>
          </div>`;
      })
      .join("");

    grid.querySelectorAll(".term-card").forEach((card) => {
      const id = Number(card.dataset.termId);
      const idx = Number(card.dataset.idx);
      const term = browseFiltered[idx];
      card.querySelectorAll("[data-act]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const act = btn.dataset.act;
          if (act === "jp") speakSingleTerm(term, "jp");
          else if (act === "zh") speakSingleTerm(term, "zh");
          else if (act === "playFrom") startContinuousPlay(idx);
          else if (act === "review") {
            setMastery(id, getMastery(id) === "review" ? "new" : "review");
            renderBrowseGrid();
          } else if (act === "mastered") {
            setMastery(id, getMastery(id) === "mastered" ? "new" : "mastered");
            renderBrowseGrid();
          }
        });
      });
    });

    const pBar = document.getElementById("paginationBar");
    pBar.innerHTML = `
      <button class="btn" id="pgPrev" ${browsePage <= 1 ? "disabled" : ""}>← 上一頁</button>
      <span style="font-size:13px;color:var(--text-soft);">第 ${browsePage} / ${totalPages} 頁（共 ${browseFiltered.length} 筆）</span>
      <button class="btn" id="pgNext" ${browsePage >= totalPages ? "disabled" : ""}>下一頁 →</button>
    `;
    document.getElementById("pgPrev").addEventListener("click", () => {
      if (browsePage > 1) {
        browsePage--;
        renderBrowseGrid();
        document.getElementById("termsScroll").scrollTop = 0;
      }
    });
    document.getElementById("pgNext").addEventListener("click", () => {
      if (browsePage < totalPages) {
        browsePage++;
        renderBrowseGrid();
        document.getElementById("termsScroll").scrollTop = 0;
      }
    });
  }

  function jumpToBrowse(catId, subName, autoPlay = false) {
    document.getElementById("selCat").value = catId || "";
    updateSubSelect();
    if (subName) document.getElementById("selSub").value = subName;
    document.getElementById("txtSearch").value = "";
    applyBrowseFilter(true);
    switchView("browse");
    if (autoPlay && browseFiltered.length > 0) {
      startContinuousPlay(0);
    }
  }

  // Continuous Read-Aloud Engine
  async function startContinuousPlay(startIdx = null) {
    if (browseFiltered.length === 0) return;
    if (startIdx !== null) playIndex = startIdx;
    if (playIndex >= browseFiltered.length) playIndex = 0;

    isPlaying = true;
    playRunId += 1;
    const runId = playRunId;
    document.getElementById("btnPlayPause").textContent = "⏸ 暫停朗讀";

    while (isPlaying && runId === playRunId) {
      const term = browseFiltered[playIndex];
      if (!term) break;

      speakingTermId = term.id;
      const targetPage = Math.floor(playIndex / PAGE_SIZE) + 1;
      if (targetPage !== browsePage) {
        browsePage = targetPage;
        renderBrowseGrid();
      } else {
        document.querySelectorAll(".term-card.is-speaking").forEach((c) => c.classList.remove("is-speaking"));
        const card = document.querySelector(`.term-card[data-term-id="${term.id}"]`);
        if (card) {
          card.classList.add("is-speaking");
          card.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }

      document.getElementById("playerNowText").innerHTML =
        `🔊 <strong>[${playIndex + 1}/${browseFiltered.length}]</strong> ${esc(term.jp)} — <span style="color:var(--primary)">${esc(term.zh)}</span>`;

      // Prefetch next term's Japanese audio for zero-gap playback
      const nextIdx = (playIndex + 1) % browseFiltered.length;
      if (browseFiltered[nextIdx]) {
        const nextTerm = browseFiltered[nextIdx];
        TTS.prefetch(nextTerm.jp, "ja", `audio/ja/${nextTerm.id}.mp3`);
      }

      const mode = document.getElementById("selPlayMode").value;
      const pauseMs = parseInt(document.getElementById("selPauseMs").value, 10) || 900;

      try {
        const finished = await TTS.speakSequence(buildSpeakSteps(term, mode), pauseMs);
        if (!finished || !isPlaying || runId !== playRunId) break;
      } catch (err) {
        alert(err.message || String(err));
        stopContinuousPlay();
        break;
      }

      // Pause between terms
      await new Promise((r) => setTimeout(r, Math.max(500, pauseMs)));
      if (!isPlaying || runId !== playRunId) break;

      if (document.getElementById("chkShuffle").checked) {
        playIndex = Math.floor(Math.random() * browseFiltered.length);
      } else {
        playIndex += 1;
        if (playIndex >= browseFiltered.length) {
          if (document.getElementById("chkLoop").checked) {
            playIndex = 0;
          } else {
            stopContinuousPlay();
            break;
          }
        }
      }
    }
  }

  function stopContinuousPlay() {
    isPlaying = false;
    playRunId += 1;
    speakingTermId = null;
    TTS.stop();
    document.getElementById("btnPlayPause").textContent = "▶ 開始連續朗讀";
    document.querySelectorAll(".term-card.is-speaking").forEach((c) => c.classList.remove("is-speaking"));
  }

  function initBrowseControls() {
    document.getElementById("selCat").addEventListener("change", () => {
      updateSubSelect();
      applyBrowseFilter(true);
    });
    document.getElementById("selSub").addEventListener("change", () => applyBrowseFilter(true));
    document.getElementById("selImp").addEventListener("change", () => applyBrowseFilter(true));
    document.getElementById("selMastery").addEventListener("change", () => applyBrowseFilter(true));
    document.getElementById("chkFlagOnly").addEventListener("change", () => applyBrowseFilter(true));
    document.getElementById("txtSearch").addEventListener("input", () => applyBrowseFilter(true));

    document.getElementById("btnPlayPause").addEventListener("click", () => {
      if (isPlaying) {
        isPlaying = false;
        playRunId += 1;
        TTS.stop();
        document.getElementById("btnPlayPause").textContent = "▶ 繼續朗讀";
      } else {
        startContinuousPlay(playIndex);
      }
    });
    document.getElementById("btnStopPlay").addEventListener("click", () => {
      stopContinuousPlay();
      playIndex = 0;
      document.getElementById("playerNowText").textContent = "已停止朗讀";
    });
    document.getElementById("btnPrevTerm").addEventListener("click", () => {
      if (browseFiltered.length === 0) return;
      playIndex = (playIndex - 1 + browseFiltered.length) % browseFiltered.length;
      startContinuousPlay(playIndex);
    });
    document.getElementById("btnNextTerm").addEventListener("click", () => {
      if (browseFiltered.length === 0) return;
      playIndex = (playIndex + 1) % browseFiltered.length;
      startContinuousPlay(playIndex);
    });
  }

  // ========== VIEW 3: FLASHCARDS ==========
  function buildFlashcardDeck() {
    const catId = document.getElementById("fcCat").value;
    const imp = document.getElementById("fcImp").value;
    fcDeck = DATA.terms.filter((t) => {
      if (catId && t.cat !== catId) return false;
      if (imp && t.imp !== imp) return false;
      return true;
    });
    fcIndex = 0;
    fcFlipped = false;
    renderFlashcard();
  }

  function renderFlashcard() {
    const counter = document.getElementById("fcCounter");
    const card = document.getElementById("fcCard");
    const front = document.getElementById("fcFront");
    const back = document.getElementById("fcBack");

    card.classList.toggle("flipped", fcFlipped);

    if (fcDeck.length === 0) {
      counter.textContent = "0 / 0";
      front.innerHTML = `<div class="fc-main-text">此篩選條件無術語</div>`;
      back.innerHTML = "";
      return;
    }

    const t = fcDeck[fcIndex];
    const cat = CAT_MAP.get(t.cat);
    const dir = document.getElementById("fcDir").value;
    const showKana = document.getElementById("fcShowKana").checked;
    const st = getMastery(t.id);

    counter.textContent = `${fcIndex + 1} / ${fcDeck.length}`;

    const topMeta = `
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12.5px;">
        <span style="color:${cat.color};font-weight:700;">${esc(cat.code)} ${esc(cat.name)} · ${esc(t.sub)}</span>
        <div style="display:flex;gap:6px;">
          ${t.imp ? `<span class="tag ${t.imp === "A" ? "tag-a" : "tag-b"}">重要度 ${esc(t.imp)}</span>` : ""}
          ${st === "mastered" ? `<span class="tag" style="background:var(--ok-soft);color:var(--ok);">✅ 已熟記</span>` : ""}
          ${st === "review" ? `<span class="tag tag-flag">⭐ 待複習</span>` : ""}
        </div>
      </div>`;

    if (dir === "jp2zh") {
      front.innerHTML = `
        ${topMeta}
        <div>
          <div class="fc-main-text">${esc(t.jp)}</div>
          ${showKana && t.kana ? `<div class="fc-sub-text">${esc(t.kana)}</div>` : ""}
        </div>
        <div style="text-align:center;font-size:12px;color:var(--text-soft);">點擊卡片或按 Space 翻面查看繁中標準翻譯</div>
      `;
      back.innerHTML = `
        ${topMeta}
        <div>
          <div class="fc-main-text" style="color:var(--primary);">${esc(t.zh)}</div>
          ${t.en ? `<div class="fc-sub-text" style="font-family:Consolas,monospace;">${esc(t.en)}</div>` : ""}
          ${t.usage ? `<div class="insp-block" style="margin-top:12px;"><strong>現場用途：</strong>${esc(t.usage)}</div>` : ""}
          ${t.note ? `<div class="insp-block" style="margin-top:8px;"><strong>口譯注意：</strong>${esc(t.note)}</div>` : ""}
        </div>
        <div style="text-align:center;font-size:12px;color:var(--text-soft);">${esc(t.jp)} ${t.kana ? `(${esc(t.kana)})` : ""}</div>
      `;
    } else {
      front.innerHTML = `
        ${topMeta}
        <div>
          <div class="fc-main-text" style="color:var(--primary);">${esc(t.zh)}</div>
          ${t.en ? `<div class="fc-sub-text">${esc(t.en)}</div>` : ""}
        </div>
        <div style="text-align:center;font-size:12px;color:var(--text-soft);">點擊卡片或按 Space 翻面查看日文術語</div>
      `;
      back.innerHTML = `
        ${topMeta}
        <div>
          <div class="fc-main-text">${esc(t.jp)}</div>
          ${t.kana ? `<div class="fc-sub-text">${esc(t.kana)}</div>` : ""}
          ${t.usage ? `<div class="insp-block" style="margin-top:12px;"><strong>現場用途：</strong>${esc(t.usage)}</div>` : ""}
        </div>
        <div style="text-align:center;font-size:12px;color:var(--text-soft);">${esc(t.zh)}</div>
      `;
    }
  }

  function fcAutoSpeakCurrent() {
    if (!document.getElementById("fcAutoSpeak").checked || fcDeck.length === 0) return;
    const t = fcDeck[fcIndex];
    const dir = document.getElementById("fcDir").value;
    const isJp = dir === "jp2zh";
    TTS.speak(isJp ? t.jp : t.zh, isJp ? "ja" : "zh", isJp ? `audio/ja/${t.id}.mp3` : `audio/zh/${t.id}.mp3`).catch(() => {});
  }

  function initFlashcards() {
    document.getElementById("fcCat").addEventListener("change", buildFlashcardDeck);
    document.getElementById("fcImp").addEventListener("change", buildFlashcardDeck);
    document.getElementById("fcDir").addEventListener("change", () => {
      fcFlipped = false;
      renderFlashcard();
    });
    document.getElementById("fcShowKana").addEventListener("change", renderFlashcard);
    document.getElementById("fcShuffleBtn").addEventListener("click", () => {
      for (let i = fcDeck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [fcDeck[i], fcDeck[j]] = [fcDeck[j], fcDeck[i]];
      }
      fcIndex = 0;
      fcFlipped = false;
      renderFlashcard();
      fcAutoSpeakCurrent();
    });

    const flip = () => {
      fcFlipped = !fcFlipped;
      renderFlashcard();
    };
    document.getElementById("fcCard").addEventListener("click", flip);
    document.getElementById("fcFlip").addEventListener("click", flip);

    document.getElementById("fcPrev").addEventListener("click", () => {
      if (!fcDeck.length) return;
      fcIndex = (fcIndex - 1 + fcDeck.length) % fcDeck.length;
      fcFlipped = false;
      renderFlashcard();
      fcAutoSpeakCurrent();
    });
    document.getElementById("fcNext").addEventListener("click", () => {
      if (!fcDeck.length) return;
      fcIndex = (fcIndex + 1) % fcDeck.length;
      fcFlipped = false;
      renderFlashcard();
      fcAutoSpeakCurrent();
    });
    document.getElementById("fcSpeakJp").addEventListener("click", () => {
      if (fcDeck[fcIndex]) speakSingleTerm(fcDeck[fcIndex], "jp");
    });
    document.getElementById("fcSpeakZh").addEventListener("click", () => {
      if (fcDeck[fcIndex]) speakSingleTerm(fcDeck[fcIndex], "zh");
    });
    document.getElementById("fcMarkReview").addEventListener("click", () => {
      if (!fcDeck[fcIndex]) return;
      setMastery(fcDeck[fcIndex].id, "review");
      renderFlashcard();
    });
    document.getElementById("fcMarkMastered").addEventListener("click", () => {
      if (!fcDeck[fcIndex]) return;
      setMastery(fcDeck[fcIndex].id, "mastered");
      fcIndex = (fcIndex + 1) % fcDeck.length;
      fcFlipped = false;
      renderFlashcard();
      fcAutoSpeakCurrent();
    });

    // Keyboard shortcuts when in Flashcard view
    window.addEventListener("keydown", (e) => {
      if (currentView !== "flashcard") return;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        flip();
      } else if (e.key === "ArrowRight") {
        document.getElementById("fcNext").click();
      } else if (e.key === "ArrowLeft") {
        document.getElementById("fcPrev").click();
      } else if (e.key.toLowerCase() === "j") {
        document.getElementById("fcSpeakJp").click();
      } else if (e.key.toLowerCase() === "z") {
        document.getElementById("fcSpeakZh").click();
      } else if (e.key === "1") {
        document.getElementById("fcMarkReview").click();
      } else if (e.key === "2") {
        document.getElementById("fcMarkMastered").click();
      }
    });
  }

  // ========== VIEW 4: QUIZ ==========
  function startQuizQuestion() {
    const catId = document.getElementById("qzCat").value;
    const mode = document.getElementById("qzMode").value;
    qzPool = DATA.terms.filter((t) => (!catId || t.cat === catId) && t.jp && t.zh);
    const card = document.getElementById("quizCard");

    if (qzPool.length < 4) {
      card.innerHTML = `<p>此分類術語不足 4 筆，請選擇其他分類。</p>`;
      return;
    }

    const answer = qzPool[Math.floor(Math.random() * qzPool.length)];
    const options = [answer];
    const usedZh = new Set([answer.zh]);
    const usedJp = new Set([answer.jp]);
    let guard = 0;
    while (options.length < 4 && guard < 200) {
      guard++;
      const cand = qzPool[Math.floor(Math.random() * qzPool.length)];
      if (mode === "zh2jp") {
        if (!usedJp.has(cand.jp)) {
          usedJp.add(cand.jp);
          options.push(cand);
        }
      } else {
        if (!usedZh.has(cand.zh)) {
          usedZh.add(cand.zh);
          options.push(cand);
        }
      }
    }
    // Shuffle options
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }

    qzCurrent = { answer, options, mode };
    qzAnswered = false;
    renderQuizCard();

    if (mode === "listen") {
      TTS.speak(answer.jp, "ja", `audio/ja/${answer.id}.mp3`).catch(() => {});
    }
  }

  function renderQuizCard() {
    const { answer, options, mode } = qzCurrent;
    const cat = CAT_MAP.get(answer.cat);
    const card = document.getElementById("quizCard");
    document.getElementById("qzScore").textContent = `答對 ${qzCorrect} / ${qzTotal}`;

    let promptHtml = "";
    if (mode === "jp2zh") {
      promptHtml = `
        <div class="fc-main-text">${esc(answer.jp)}</div>
        ${answer.kana ? `<div class="fc-sub-text">${esc(answer.kana)}</div>` : ""}
        <div style="text-align:center;margin-top:8px;"><button class="btn" id="qzPlayPrompt">🔊 朗讀題目</button></div>
      `;
    } else if (mode === "zh2jp") {
      promptHtml = `
        <div class="fc-main-text" style="color:var(--primary);">${esc(answer.zh)}</div>
        ${answer.en ? `<div class="fc-sub-text">${esc(answer.en)}</div>` : ""}
      `;
    } else {
      promptHtml = `
        <div style="text-align:center;padding:18px 0;">
          <button class="btn btn-primary" id="qzPlayPrompt" style="font-size:16px;padding:12px 22px;">🎧 再聽一次日文發音</button>
          <div style="font-size:12.5px;color:var(--text-soft);margin-top:8px;">請聆聽微軟日文神經語音，選出對應的繁體中文工程術語</div>
        </div>
      `;
    }

    const optsHtml = options
      .map((opt, idx) => {
        const label = mode === "zh2jp" ? `${esc(opt.jp)}${opt.kana ? ` <span style="font-size:12px;color:var(--text-soft);">(${esc(opt.kana)})</span>` : ""}` : esc(opt.zh);
        return `<button class="quiz-opt" data-idx="${idx}">${String.fromCharCode(65 + idx)}. ${label}</button>`;
      })
      .join("");

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;">
        <span style="color:${cat.color};font-weight:700;">${esc(cat.code)} ${esc(cat.name)} · ${esc(answer.sub)}</span>
        ${answer.imp ? `<span class="tag ${answer.imp === "A" ? "tag-a" : "tag-b"}">重要度 ${esc(answer.imp)}</span>` : ""}
      </div>
      ${promptHtml}
      <div class="quiz-options">${optsHtml}</div>
      <div id="qzFeedback" style="margin-top:16px;"></div>
    `;

    const playBtn = document.getElementById("qzPlayPrompt");
    if (playBtn) {
      playBtn.addEventListener("click", () => TTS.speak(answer.jp, "ja", `audio/ja/${answer.id}.mp3`).catch(() => {}));
    }

    card.querySelectorAll(".quiz-opt").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (qzAnswered) return;
        qzAnswered = true;
        qzTotal += 1;
        const chosen = options[Number(btn.dataset.idx)];
        const isCorrect = chosen.id === answer.id;
        if (isCorrect) qzCorrect += 1;

        card.querySelectorAll(".quiz-opt").forEach((b) => {
          b.disabled = true;
          const opt = options[Number(b.dataset.idx)];
          if (opt.id === answer.id) b.classList.add("correct");
          else if (b === btn && !isCorrect) b.classList.add("wrong");
        });

        document.getElementById("qzScore").textContent = `答對 ${qzCorrect} / ${qzTotal}`;
        document.getElementById("qzFeedback").innerHTML = `
          <div class="insp-block">
            <div style="font-weight:800;color:${isCorrect ? "var(--ok)" : "var(--danger)"};margin-bottom:4px;">
              ${isCorrect ? "✅ 答對了！" : "❌ 答錯了，正確答案："} ${esc(answer.jp)} (${esc(answer.kana)}) ＝ ${esc(answer.zh)}
            </div>
            ${answer.usage ? `<div>${esc(answer.usage)}</div>` : ""}
            <div style="margin-top:10px;display:flex;gap:8px;">
              <button class="btn btn-primary" id="qzNextBtn">下一題 →</button>
              <button class="btn" id="qzSpeakAns">🔊 雙語朗讀</button>
              ${!isCorrect ? `<button class="btn btn-warn" id="qzAddRev">⭐ 加入待複習</button>` : ""}
            </div>
          </div>
        `;
        document.getElementById("qzNextBtn").addEventListener("click", startQuizQuestion);
        document.getElementById("qzSpeakAns").addEventListener("click", () => speakSingleTerm(answer, "jp-zh"));
        const revBtn = document.getElementById("qzAddRev");
        if (revBtn) {
          revBtn.addEventListener("click", () => {
            setMastery(answer.id, "review");
            revBtn.textContent = "⭐ 已加入待複習";
          });
        }
      });
    });
  }

  function initQuiz() {
    document.getElementById("qzCat").addEventListener("change", startQuizQuestion);
    document.getElementById("qzMode").addEventListener("change", startQuizQuestion);
    document.getElementById("qzNewBtn").addEventListener("click", startQuizQuestion);
  }

  // ========== BOOT ==========
  initTheme();
  initVoiceUI();
  updateBrandStats();
  populateCategorySelects();
  initMindMap();
  initBrowseControls();
  applyBrowseFilter(true);
  initFlashcards();
  initQuiz();
})();
