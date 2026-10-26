#!/bin/sh
# Makes the README loop (docs/showcase/hitomeguri-800x500.webp) from the M4 showcase MP4
# (canal, 1日の光, 24 s, 1280x854; app/reports/showcase/, not in Git).
# Animated WebP, not GIF: every frame recolours the whole picture, so GIF's LZW gains nothing
# (12 fps GIF was 66 MB). WebP stores each frame whole too, so size follows the frame count:
# the day is played at 2x (12 s) and 10 fps, quality 88 (70 left blocks in the night sky).
# The 2x loop passes flash-check (WCAG and ITU, at most 1 flash per second).
# Usage from the repo root: sh experiments/brand/loop.sh
set -eu
ffmpeg -loglevel error -y -i app/reports/showcase/hitomeguri-canal-day.mp4 \
  -vf "setpts=PTS/2,crop=1280:800:0:31,scale=800:500:flags=lanczos,fps=10" \
  -c:v libwebp_anim -lossless 0 -q:v 88 -compression_level 6 -loop 0 \
  docs/showcase/hitomeguri-800x500.webp
