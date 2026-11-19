/**
 * CF763 TTS Engine
 * 強制使用微軟真人神經語音 (Microsoft Neural / Edge-TTS)，嚴格排除所有 Google 語音。
 * 支援男女聲切換（Nanami/Keita、HsiaoChen/YunJhe）與即時變速（0.7x–1.4x）。
 */
(function (global) {
  "use strict";

  const PREFERRED_MS_JA_FEMALE = ["Nanami", "Haruka", "Ayumi", "Sayaka", "Natural"];
  const PREFERRED_MS_JA_MALE = ["Keita", "Ichiro", "Natural"];
  const PREFERRED_MS_ZH_FEMALE = ["HsiaoChen", "HsiaoYu", "Hanhan", "Yating", "Natural"];
  const PREFERRED_MS_ZH_MALE = ["YunJhe", "Zhiwei", "Natural"];

  class TTSEngine {
    constructor() {
      this.serverAvailable = false;
      this.staticAudioAvailable = false;
      this.staticMaleAvailable = false;
      this.staticManifest = null;
      this.jaVoice = localStorage.getItem("cf763_ja_voice") || "ja-JP-NanamiNeural";
      this.zhVoice = localStorage.getItem("cf763_zh_voice") || "zh-TW-HsiaoChenNeural";
      this.rate = parseFloat(localStorage.getItem("cf763_tts_rate") || "1.0");
      this.currentAudio = null;
      this.activeToken = 0;
      this.speechVoices = [];
      this.onStatusChange = null;

      this._initWebSpeechVoices();
      this._probeBackends();
    }

    _initWebSpeechVoices() {
      if (!("speechSynthesis" in global)) return;
      const load = () => {
        const all = global.speechSynthesis.getVoices() || [];
        // 嚴格排除所有 Google 語音
        this.speechVoices = all.filter((v) => !/google/i.test(v.name));
        this._emitStatus();
      };
      load();
      global.speechSynthesis.onvoiceschanged = load;
    }

    async _probeBackends() {
      // 1. 偵測預產靜態微軟神經語音包
      try {
        const res = await fetch("audio/manifest.json", { cache: "no-store" });
        if (res.ok) {
          const manifest = await res.json();
          if (manifest && manifest.jaCount > 0) {
            this.staticAudioAvailable = true;
            this.staticMaleAvailable = Boolean(manifest.jaMaleCount > 0 && manifest.zhMaleCount > 0);
            this.staticManifest = manifest;
          }
        }
      } catch (_) {
        this.staticAudioAvailable = false;
        this.staticMaleAvailable = false;
      }

      // 2. 偵測本機 Edge-TTS 伺服器
      if (global.location.protocol !== "file:") {
        try {
          const res = await fetch("/api/health", { cache: "no-store" });
          if (res.ok) {
            const data = await res.json();
            this.serverAvailable = Boolean(data && data.ok);
          }
        } catch (_) {
          this.serverAvailable = false;
        }
      }
      this._emitStatus();
    }

    _emitStatus() {
      if (typeof this.onStatusChange === "function") {
        this.onStatusChange(this.getStatus());
      }
    }

    isMaleSelected(lang) {
      return lang === "ja" ? /Keita/i.test(this.jaVoice) : /YunJhe/i.test(this.zhVoice);
    }

    getStatus() {
      const jaShort = this.jaVoice.replace("ja-JP-", "").replace("Neural", "");
      const zhShort = this.zhVoice.replace("zh-TW-", "").replace("Neural", "");

      if (this.serverAvailable) {
        return {
          mode: "edge-tts",
          ok: true,
          label: `微軟神經語音 (${jaShort} / ${zhShort})`,
          detail: "本機 Edge-TTS 伺服器已連線，支援男女聲切換與變速",
        };
      }
      if (this.staticAudioAvailable) {
        return {
          mode: "static-neural",
          ok: true,
          label: `微軟神經語音 (${jaShort} / ${zhShort} 內建音檔)`,
          detail: this.staticMaleAvailable
            ? "已載入微軟男女雙聲神經語音 MP3，全瀏覽器皆可切換男女聲與變速"
            : "已載入微軟神經語音 MP3（女聲全套；男聲將優先使用本機或 Edge 微軟男聲）",
        };
      }
      const msJa = this._pickMicrosoftWebVoice("ja");
      const msZh = this._pickMicrosoftWebVoice("zh");
      if (msJa || msZh) {
        return {
          mode: "webspeech-ms",
          ok: true,
          label: `微軟系統語音 (${msJa ? msJa.name.replace(/^Microsoft\s+/i, "") : "無日文"} / ${msZh ? msZh.name.replace(/^Microsoft\s+/i, "") : "無中文"})`,
          detail: "已自動排除 Google 語音；建議使用線上版或執行 start_app.bat 啟用完整微軟神經語音",
        };
      }
      return {
        mode: "no-ms-voice",
        ok: false,
        label: "未偵測到微軟語音（已封鎖 Google 語音）",
        detail: "請使用線上公開版、雙擊 start_app.bat 或改用 Microsoft Edge 開啟",
      };
    }

    setVoices(jaVoice, zhVoice) {
      if (jaVoice) {
        this.jaVoice = jaVoice;
        localStorage.setItem("cf763_ja_voice", jaVoice);
      }
      if (zhVoice) {
        this.zhVoice = zhVoice;
        localStorage.setItem("cf763_zh_voice", zhVoice);
      }
      this._emitStatus();
    }

    setRate(rate) {
      this.rate = Math.max(0.6, Math.min(1.6, parseFloat(rate) || 1.0));
      localStorage.setItem("cf763_tts_rate", String(this.rate));
      if (this.currentAudio) {
        try {
          this.currentAudio.defaultPlaybackRate = this.rate;
          this.currentAudio.playbackRate = this.rate;
        } catch (_) {}
      }
    }

    _pickMicrosoftWebVoice(lang) {
      const isJa = lang === "ja";
      const isMale = this.isMaleSelected(lang);
      const langRegex = isJa ? /^ja(-|_|$)/i : /^zh(-|_)?(TW|Hant)/i;
      const fallbackLangRegex = isJa ? /^ja/i : /^zh/i;

      // 依使用者選擇的男女聲優先排序
      const preferredNames = isJa
        ? isMale
          ? [...PREFERRED_MS_JA_MALE, ...PREFERRED_MS_JA_FEMALE]
          : [...PREFERRED_MS_JA_FEMALE, ...PREFERRED_MS_JA_MALE]
        : isMale
        ? [...PREFERRED_MS_ZH_MALE, ...PREFERRED_MS_ZH_FEMALE]
        : [...PREFERRED_MS_ZH_FEMALE, ...PREFERRED_MS_ZH_MALE];

      const msCandidates = this.speechVoices.filter(
        (v) => !/google/i.test(v.name) && /microsoft/i.test(v.name) && (langRegex.test(v.lang) || fallbackLangRegex.test(v.lang))
      );

      for (const kw of preferredNames) {
        const found = msCandidates.find((v) => v.name.toLowerCase().includes(kw.toLowerCase()));
        if (found) return found;
      }
      if (msCandidates.length > 0) return msCandidates[0];

      const nonGoogle = this.speechVoices.filter(
        (v) => !/google/i.test(v.name) && langRegex.test(v.lang)
      );
      return nonGoogle[0] || null;
    }

    stop() {
      this.activeToken += 1;
      if (this.currentAudio) {
        try {
          this.currentAudio.pause();
          this.currentAudio.src = "";
        } catch (_) {}
        this.currentAudio = null;
      }
      if ("speechSynthesis" in global) {
        try {
          global.speechSynthesis.cancel();
        } catch (_) {}
      }
    }

    _resolveStaticPath(lang, audioPath) {
      if (!audioPath) return null;
      const isMale = this.isMaleSelected(lang);
      if (!isMale) {
        return this.staticAudioAvailable ? audioPath : null;
      }
      // 男聲：若有預產男聲靜態包，自動對應到 ja_m / zh_m / test_ja_m / test_zh_m
      if (this.staticMaleAvailable) {
        if (audioPath === "audio/test_ja.mp3") return "audio/test_ja_m.mp3";
        if (audioPath === "audio/test_zh.mp3") return "audio/test_zh_m.mp3";
        return audioPath.replace(/^audio\/(ja|zh)\//, "audio/$1_m/");
      }
      return null;
    }

    prefetch(text, lang, audioPath = null) {
      const staticUrl = this._resolveStaticPath(lang, audioPath);
      if (staticUrl) {
        fetch(staticUrl).catch(() => {});
        return;
      }
      if (!this.serverAvailable || !text) return;
      const voice = lang === "ja" ? this.jaVoice : this.zhVoice;
      const url = `/api/tts?text=${encodeURIComponent(text)}&lang=${encodeURIComponent(lang)}&voice=${encodeURIComponent(voice)}&rate=1.00`;
      fetch(url).catch(() => {});
    }

    speak(text, lang = "ja", audioPath = null) {
      const cleanText = String(text || "").trim();
      if (!cleanText && !audioPath) return Promise.resolve();

      this.stop();
      const token = this.activeToken;
      return this._speakKeepingToken(cleanText, lang, token, audioPath);
    }

    _playAudioUrl(url, token) {
      return new Promise((resolve, reject) => {
        if (token !== this.activeToken) return resolve();
        const audio = new Audio(url);
        const applyRate = () => {
          try {
            audio.defaultPlaybackRate = this.rate;
            audio.playbackRate = this.rate;
          } catch (_) {}
        };
        applyRate();
        audio.addEventListener("loadedmetadata", applyRate);
        audio.addEventListener("playing", applyRate);
        this.currentAudio = audio;

        const cleanup = () => {
          if (this.currentAudio === audio) this.currentAudio = null;
        };

        audio.onended = () => {
          cleanup();
          resolve();
        };
        audio.onerror = () => {
          cleanup();
          reject(new Error("AUDIO_LOAD_FAILED"));
        };
        audio.play().then(applyRate).catch((err) => {
          cleanup();
          if (token !== this.activeToken) return resolve();
          reject(err);
        });
      });
    }

    async _speakKeepingToken(text, lang, seqToken, audioPath = null) {
      // 1. 優先使用符合所選男女聲的靜態微軟神經語音 MP3（並即時套用 playbackRate 變速）
      const staticUrl = this._resolveStaticPath(lang, audioPath);
      if (staticUrl) {
        try {
          await this._playAudioUrl(staticUrl, seqToken);
          return;
        } catch (_) {
          if (seqToken !== this.activeToken) return;
        }
      }

      // 2. 次選本機 Edge-TTS 伺服器（支援即時切換男聲 Keita / YunJhe，並套用 playbackRate）
      if (this.serverAvailable && text) {
        const voice = lang === "ja" ? this.jaVoice : this.zhVoice;
        const url = `/api/tts?text=${encodeURIComponent(text)}&lang=${encodeURIComponent(lang)}&voice=${encodeURIComponent(voice)}&rate=1.00`;
        try {
          await this._playAudioUrl(url, seqToken);
          return;
        } catch (_) {
          if (seqToken !== this.activeToken) return;
        }
      }

      // 3. 若選了男聲且無男聲靜態包／本機伺服器，優先嘗試微軟系統男聲 (Edge)
      const msVoice = this._pickMicrosoftWebVoice(lang);
      if (msVoice) {
        return this._speakViaWebSpeech(text, lang, seqToken, msVoice);
      }

      // 4. 若系統無微軟男聲（例如 Chrome 靜態版），退回內建女聲微軟神經語音 MP3（不退回 Google 語音）
      if (this.staticAudioAvailable && audioPath) {
        try {
          await this._playAudioUrl(audioPath, seqToken);
          return;
        } catch (_) {
          if (seqToken !== this.activeToken) return;
        }
      }

      throw new Error("未找到可用的微軟語音（已依規範封鎖 Google 語音）。");
    }

    _speakViaWebSpeech(text, lang, token, preselectedVoice = null) {
      return new Promise((resolve, reject) => {
        if (token !== this.activeToken) return resolve();
        if (!("speechSynthesis" in global)) {
          return reject(new Error("瀏覽器不支援語音合成。"));
        }
        const voice = preselectedVoice || this._pickMicrosoftWebVoice(lang);
        if (!voice) {
          return reject(new Error("未找到可用的微軟語音（已依規範封鎖 Google 語音）。"));
        }
        const utter = new SpeechSynthesisUtterance(text);
        utter.voice = voice;
        utter.lang = lang === "ja" ? "ja-JP" : "zh-TW";
        utter.rate = this.rate;
        utter.onend = () => resolve();
        utter.onerror = (e) => {
          if (token !== this.activeToken || (e && e.error === "interrupted")) {
            resolve();
          } else {
            reject(e);
          }
        };
        global.speechSynthesis.speak(utter);
      });
    }

    async speakSequence(steps, pauseMs = 900) {
      this.stop();
      const seqToken = this.activeToken;

      for (let i = 0; i < steps.length; i++) {
        if (this.activeToken !== seqToken) return false;
        const step = steps[i];
        if (!step || (!step.text && !step.audioPath)) continue;
        if (i + 1 < steps.length && steps[i + 1]) {
          this.prefetch(steps[i + 1].text, steps[i + 1].lang, steps[i + 1].audioPath || null);
        }
        await this._speakKeepingToken(step.text, step.lang, seqToken, step.audioPath || null);
        if (this.activeToken !== seqToken) return false;
        if (i < steps.length - 1 && pauseMs > 0) {
          await this._delay(pauseMs, seqToken);
        }
      }
      return this.activeToken === seqToken;
    }

    _delay(ms, seqToken) {
      return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        const check = setInterval(() => {
          if (this.activeToken !== seqToken) {
            clearTimeout(timer);
            clearInterval(check);
            resolve();
          }
        }, 80);
        setTimeout(() => clearInterval(check), ms + 120);
      });
    }
  }

  global.CF763TTS = new TTSEngine();
})(window);
