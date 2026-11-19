import asyncio
import json
import os
import sys
import time
import edge_tts

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(APP_DIR, "data", "terms_data.json")
AUDIO_DIR = os.path.join(APP_DIR, "audio")

VOICES = {
    "female": {
        "ja_voice": "ja-JP-NanamiNeural",
        "zh_voice": "zh-TW-HsiaoChenNeural",
        "ja_dir": os.path.join(AUDIO_DIR, "ja"),
        "zh_dir": os.path.join(AUDIO_DIR, "zh"),
        "test_ja": os.path.join(AUDIO_DIR, "test_ja.mp3"),
        "test_zh": os.path.join(AUDIO_DIR, "test_zh.mp3"),
    },
    "male": {
        "ja_voice": "ja-JP-KeitaNeural",
        "zh_voice": "zh-TW-YunJheNeural",
        "ja_dir": os.path.join(AUDIO_DIR, "ja_m"),
        "zh_dir": os.path.join(AUDIO_DIR, "zh_m"),
        "test_ja": os.path.join(AUDIO_DIR, "test_ja_m.mp3"),
        "test_zh": os.path.join(AUDIO_DIR, "test_zh_m.mp3"),
    },
}


async def synth_one(sem, text, voice, out_path, stats):
    if not text or (os.path.exists(out_path) and os.path.getsize(out_path) > 200):
        stats["skipped"] += 1
        return
    async with sem:
        for attempt in range(4):
            try:
                tmp = out_path + ".tmp"
                comm = edge_tts.Communicate(text=text, voice=voice)
                await comm.save(tmp)
                if os.path.exists(tmp) and os.path.getsize(tmp) > 200:
                    os.replace(tmp, out_path)
                    stats["done"] += 1
                    return
            except Exception:
                await asyncio.sleep(0.6 * (attempt + 1))
        stats["failed"] += 1


async def main():
    mode = "male" if "--male" in sys.argv else "female"
    cfg = VOICES[mode]
    os.makedirs(cfg["ja_dir"], exist_ok=True)
    os.makedirs(cfg["zh_dir"], exist_ok=True)

    with open(DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    terms = data["terms"]

    concurrency = 24
    sem = asyncio.Semaphore(concurrency)
    stats = {"done": 0, "skipped": 0, "failed": 0}

    tasks = [
        synth_one(sem, "シールドマシン、受変電設備", cfg["ja_voice"], cfg["test_ja"], stats),
        synth_one(sem, "潛盾機、受變電設備，微軟真人語音測試正常", cfg["zh_voice"], cfg["test_zh"], stats),
    ]

    for t in terms:
        tid = t["id"]
        jp = (t.get("jp") or t.get("kana") or "").strip()
        zh = (t.get("zh") or "").strip()
        if jp:
            tasks.append(synth_one(sem, jp, cfg["ja_voice"], os.path.join(cfg["ja_dir"], f"{tid}.mp3"), stats))
        if zh:
            tasks.append(synth_one(sem, zh, cfg["zh_voice"], os.path.join(cfg["zh_dir"], f"{tid}.mp3"), stats))

    total = len(tasks)
    t0 = time.time()
    print(f"Starting Microsoft Neural TTS ({mode}) synthesis: {total} clips...", flush=True)

    chunk_size = 200
    for start in range(0, total, chunk_size):
        await asyncio.gather(*tasks[start : start + chunk_size])
        elapsed = time.time() - t0
        processed = min(start + chunk_size, total)
        rate = (stats["done"] / elapsed) if elapsed > 0 else 0
        print(
            f"Progress ({mode}): {processed}/{total} | generated={stats['done']} skipped={stats['skipped']} failed={stats['failed']} | {elapsed:.1f}s ({rate:.1f}/s)",
            flush=True,
        )

    def count_mp3(path):
        return len([f for f in os.listdir(path) if f.endswith(".mp3")]) if os.path.isdir(path) else 0

    manifest = {
        "jaVoice": VOICES["female"]["ja_voice"],
        "zhVoice": VOICES["female"]["zh_voice"],
        "jaMaleVoice": VOICES["male"]["ja_voice"],
        "zhMaleVoice": VOICES["male"]["zh_voice"],
        "jaCount": count_mp3(VOICES["female"]["ja_dir"]),
        "zhCount": count_mp3(VOICES["female"]["zh_dir"]),
        "jaMaleCount": count_mp3(VOICES["male"]["ja_dir"]),
        "zhMaleCount": count_mp3(VOICES["male"]["zh_dir"]),
        "totalTerms": len(data["terms"]),
    }
    with open(os.path.join(AUDIO_DIR, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f"DONE ({mode}) in {time.time() - t0:.1f}s. Manifest: {manifest}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
