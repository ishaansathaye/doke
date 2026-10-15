#!/usr/bin/env python3
"""Cut a real Playwright recording into the README tour. Requires FFmpeg and gifsicle."""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "test-results/demo"
DEST = ROOT / "docs/media/doke-demo.gif"


def run(*args):
    subprocess.run(args, cwd=ROOT, check=True)


def main():
    edit = json.loads((WORK / "edit.json").read_text())
    segments = edit["segments"]
    filters = [f"[0:v]scale=960:630:flags=lanczos,split={len(segments)}" +
               "".join(f"[s{i}]" for i in range(len(segments)))]
    for i, segment in enumerate(segments):
        # A text file avoids treating caption punctuation as filter syntax.
        (WORK / f"caption-{i}.txt").write_text(segment["title"])
        filters.append(
            f"[s{i}]trim=start={segment['start']}:end={segment['end']},"
            "setpts=PTS-STARTPTS,fps=15,pad=960:674:0:0:black,"
            "drawbox=x=24:y=630:w=912:h=1:color=0x292929:t=fill,"
            f"drawtext=fontfile=public/fonts/font-1.ttf:textfile=test-results/demo/caption-{i}.txt:"
            "fontcolor=0xe8e8e8:fontsize=16:x=24:y=646,"
            "drawtext=fontfile=public/fonts/font-4.ttf:"
            f"text='{i + 1:02d} / {len(segments):02d}':fontcolor=0x909090:fontsize=11:x=w-tw-24:y=649[c{i}]"
        )
    filters.append("".join(f"[c{i}]" for i in range(len(segments))) +
                   f"concat=n={len(segments)}:v=1:a=0[out]")
    graph = WORK / "edit.ffmpeg"
    graph.write_text(";\n".join(filters))
    run("ffmpeg", "-hide_banner", "-loglevel", "warning", "-y", "-i", str(WORK / "raw.webm"),
        "-filter_complex_script", str(graph), "-map", "[out]", "-an", "-c:v", "libx264",
        "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        str(WORK / "doke-demo.mp4"))
    DEST.parent.mkdir(parents=True, exist_ok=True)
    run("ffmpeg", "-hide_banner", "-loglevel", "warning", "-y", "-i", str(WORK / "doke-demo.mp4"),
        "-filter_complex", "fps=12,scale=880:-1:flags=lanczos,split[a][b];"
        "[a]palettegen=stats_mode=diff:reserve_transparent=1[p];"
        "[b][p]paletteuse=dither=none:diff_mode=rectangle",
        "-loop", "0", str(WORK / "palette.gif"))
    # Lossless optimization preserves clean black backgrounds and small text.
    run("gifsicle", "-O3", str(WORK / "palette.gif"), "-o", str(DEST))
    print(f"Created {DEST.relative_to(ROOT)} ({DEST.stat().st_size / 1_000_000:.2f} MB)")


if __name__ == "__main__":
    main()
