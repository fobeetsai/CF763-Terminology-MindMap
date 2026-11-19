import asyncio
import json
import os
import sys
import time
import edge_tts

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(APP_DIR, "data", "terms_data.json")
AUDIO_DIR = os.path.join(APP_DIR, "audio")
JA_DIR = os.path.join(AUDIO_DIR, "ja")
ZH_DIR = os.path.join(AUDIO_DIR, "zh")

JA_VOICE = "ja-JP-NanamiNeural"
ZH_VOICE = "zh-TW-HsiaoChenNeural"


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
    os.makedirs(JA_DIR, exist_ok=True)
    os.makedirs(ZH_DIR, exist_ok=True)

    with open(DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    terms = data["terms"]

    limit = None
    for i, a in enumerate(sys.argv):
        if a == "--limit" and i + 1 < len(sys.argv):
            limit = int(sys.argv[i + 1])
    if limit is not None:
        terms = terms[:limit]

    concurrency = 24
    sem = asyncio.Semaphore(concurrency)
    stats = {"done": 0, "skipped": 0, "failed": 0}

    tasks = []
    # Test clips
    tasks.append(synth_one(sem, "シールドマシン、受変電設備", JA_VOICE, os.path.join(AUDIO_DIR, "test_ja.mp3"), stats))
    tasks.append(synth_one(sem, "潛盾機、受變電設備，微軟真人語音測試正常", ZH_VOICE, os.path.join(AUDIO_DIR, "test_zh.mp3"), stats))

    for t in terms:
        tid = t["id"]
        jp = (t.get("jp") or t.get("kana") or "").strip()
        zh = (t.get("zh") or "").strip()
        if jp:
            tasks.append(synth_one(sem, jp, JA_VOICE, os.path.join(JA_DIR, f"{tid}.mp3"), stats))
        if zh:
            tasks.append(synth_one(sem, zh, ZH_VOICE, os.path.join(ZH_DIR, f"{tid}.mp3"), stats))

    total = len(tasks)
    t0 = time.time()
    print(f"Starting Microsoft Neural TTS synthesis: {total} clips (concurrency={concurrency})...", flush=True)

    # Run in chunks so progress is printed smoothly
    chunk_size = 200
    for start in range(0, total, chunk_size):
        chunk = tasks[start : start + chunk_size]
        await asyncio.gather(*chunk)
        elapsed = time.time() - t0
        processed = min(start + chunk_size, total)
        rate = (stats["done"] / elapsed) if elapsed > 0 else 0
        print(
            f"Progress: {processed}/{total} | generated={stats['done']} skipped={stats['skipped']} failed={stats['failed']} | {elapsed:.1f}s ({rate:.1f}/s)",
            flush=True,
        )

    # Write manifest
    ja_count = len([f for f in os.listdir(JA_DIR) if f.endswith(".mp3")])
    zh_count = len([f for f in os.listdir(ZH_DIR) if f.endswith(".mp3")])
    manifest = {
        "jaVoice": JA_VOICE,
        "zhVoice": ZH_VOICE,
        "jaCount": ja_count,
        "zhCount": zh_count,
        "totalTerms": len(data["terms"]),
    }
    with open(os.path.join(AUDIO_DIR, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f"DONE in {time.time() - t0:.1f}s. Manifest: {manifest}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
