/**
 * CF763 TTS Engine
 * 強制使用微軟真人神經語音 (Microsoft Neural / Edge-TTS)，嚴格排除所有 Google 語音。
 * 優先順序：
 *   1. 靜態預產微軟神經語音 MP3 (audio/ja/{id}.mp3 & audio/zh/{id}.mp3) — 公開網頁跨裝置通用（Chrome/Safari/iOS/Android/Edge）
 *   2. 本機 Edge-TTS 伺服器 (/api/tts) — 支援即時切換男聲 Keita / YunJhe
 *   3. Web Speech API 微軟系統語音備援（嚴格排除所有 Google 語音）
 */
(function (global) {
  "use strict";

  const PREFERRED_MS_JA = ["Nanami", "Keita", "Natural", "Haruka", "Ichiro", "Ayumi", "Sayaka"];
  const PREFERRED_MS_ZH = ["HsiaoChen", "YunJhe", "HsiaoYu", "Natural", "Hanhan", "Zhiwei", "Yating"];

  class TTSEngine {
    constructor() {
      this.serverAvailable = false;
      this.staticAudioAvailable = false;
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
      // 1. 偵測預產靜態微軟神經語音包 (適用於 GitHub Pages / 公開網頁)
      try {
        const res = await fetch("audio/manifest.json", { cache: "no-store" });
        if (res.ok) {
          const manifest = await res.json();
          if (manifest && manifest.jaCount > 0) {
            this.staticAudioAvailable = true;
            this.staticManifest = manifest;
          }
        }
      } catch (_) {
        this.staticAudioAvailable = false;
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

    getStatus() {
      if (this.serverAvailable) {
        return {
          mode: "edge-tts",
          ok: true,
          label: `微軟神經語音 (${this.jaVoice.replace("ja-JP-", "").replace("Neural", "")} / ${this.zhVoice.replace("zh-TW-", "").replace("Neural", "")})`,
          detail: "本機 Edge-TTS 伺服器已連線，支援男女聲即時切換",
        };
      }
      if (this.staticAudioAvailable) {
        return {
          mode: "static-neural",
          ok: true,
          label: "微軟神經語音 (Nanami / HsiaoChen 內建音檔)",
          detail: "已載入預先產製之微軟真人神經語音 MP3，Chrome / Safari / 手機皆可流暢播放",
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
          this.currentAudio.playbackRate = this.rate;
        } catch (_) {}
      }
    }

    _pickMicrosoftWebVoice(lang) {
      const isJa = lang === "ja";
      const langRegex = isJa ? /^ja(-|_|$)/i : /^zh(-|_)?(TW|Hant)/i;
      const fallbackLangRegex = isJa ? /^ja/i : /^zh/i;
      const preferredNames = isJa ? PREFERRED_MS_JA : PREFERRED_MS_ZH;

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

    _shouldUseStatic(lang, audioPath) {
      if (!this.staticAudioAvailable || !audioPath) return false;
      // 若本機伺服器可用且使用者選擇了男聲 (非靜態預產的預設女聲)，改走本機伺服器
      if (this.serverAvailable) {
        const defaultStaticVoice = lang === "ja" ? "ja-JP-NanamiNeural" : "zh-TW-HsiaoChenNeural";
        const selectedVoice = lang === "ja" ? this.jaVoice : this.zhVoice;
        if (selectedVoice !== defaultStaticVoice) return false;
      }
      return true;
    }

    prefetch(text, lang, audioPath = null) {
      if (this._shouldUseStatic(lang, audioPath)) {
        fetch(audioPath).catch(() => {});
        return;
      }
      if (!this.serverAvailable || !text) return;
      const voice = lang === "ja" ? this.jaVoice : this.zhVoice;
      const url = `/api/tts?text=${encodeURIComponent(text)}&lang=${encodeURIComponent(lang)}&voice=${encodeURIComponent(voice)}&rate=${encodeURIComponent(this.rate.toFixed(2))}`;
      fetch(url).catch(() => {});
    }

    speak(text, lang = "ja", audioPath = null) {
      const cleanText = String(text || "").trim();
      if (!cleanText && !audioPath) return Promise.resolve();

      this.stop();
      const token = this.activeToken;
      return this._speakKeepingToken(cleanText, lang, token, audioPath);
    }

    _playAudioUrl(url, token, applyPlaybackRate = false) {
      return new Promise((resolve, reject) => {
        if (token !== this.activeToken) return resolve();
        const audio = new Audio(url);
        if (applyPlaybackRate) {
          audio.playbackRate = this.rate;
        }
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
        audio.play().catch((err) => {
          cleanup();
          if (token !== this.activeToken) return resolve();
          reject(err);
        });
      });
    }

    async _speakKeepingToken(text, lang, seqToken, audioPath = null) {
      // 1. 優先使用預先產製的微軟神經語音靜態 MP3
      if (this._shouldUseStatic(lang, audioPath)) {
        try {
          await this._playAudioUrl(audioPath, seqToken, true);
          return;
        } catch (err) {
          if (seqToken !== this.activeToken) return;
          // 檔案不存在或載入失敗時退回下一層
        }
      }

      // 2. 次選本機 Edge-TTS 伺服器
      if (this.serverAvailable && text) {
        const voice = lang === "ja" ? this.jaVoice : this.zhVoice;
        const url = `/api/tts?text=${encodeURIComponent(text)}&lang=${encodeURIComponent(lang)}&voice=${encodeURIComponent(voice)}&rate=${encodeURIComponent(this.rate.toFixed(2))}`;
        try {
          await this._playAudioUrl(url, seqToken, false);
          return;
        } catch (err) {
          if (seqToken !== this.activeToken) return;
        }
      }

      // 3. 最後備援：嚴格排除 Google 的微軟系統語音
      return this._speakViaWebSpeech(text, lang, seqToken);
    }

    _speakViaWebSpeech(text, lang, token) {
      return new Promise((resolve, reject) => {
        if (token !== this.activeToken) return resolve();
        if (!("speechSynthesis" in global)) {
          return reject(new Error("瀏覽器不支援語音合成。"));
        }
        const voice = this._pickMicrosoftWebVoice(lang);
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
