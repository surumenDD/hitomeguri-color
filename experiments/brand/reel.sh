#!/bin/sh
# Makes the README loop (docs/showcase/hitomeguri-800x500.webp): the festival girl, then the snow
# village. Each part plays one day of 1日の光 in 14 s at 7 fps (the app's default is 24 s; 9 s per
# part felt too fast), and dips to dark for 0.8 s between parts and at the loop point, so there is
# no seam. A cross-fade between different compositions looked muddy, so the parts dip to dark.
# Animated WebP, not GIF: every frame recolours the whole picture, so GIF's LZW gains nothing; WebP
# stores each frame whole too, so size follows the frame count. Quality 80: 75 bands the snow
# village's night sky.
# Usage from the repo root: sh experiments/brand/reel.sh
set -eu
out=app/test/results/showcase
D=14; R=7; F=0.8
node app/test/showcase-render.mjs "$out" festival=assets/showcase/festival-girl.png:day snow=snow:day
one() { echo "setpts=PTS*$D/24,crop=960:600:0:20,scale=800:500:flags=lanczos,fps=$R,trim=duration=$D,setpts=PTS-STARTPTS,format=yuv420p"; }
ffmpeg -loglevel error -y -i "$out/festival.mp4" -i "$out/snow.mp4" -i "$out/festival.mp4" -filter_complex "\
[0:v]$(one)[a];[1:v]$(one)[b];[2:v]$(one)[c];\
[a][b]xfade=transition=fadeblack:duration=$F:offset=$(awk "BEGIN{print $D - $F}")[ab];\
[ab][c]xfade=transition=fadeblack:duration=$F:offset=$(awk "BEGIN{print 2*$D - 2*$F}"),trim=start=$F:end=$(awk "BEGIN{print 2*$D - $F}"),setpts=PTS-STARTPTS[out]" \
  -map "[out]" -c:v libx264 -crf 10 -pix_fmt yuv420p "$out/reel.mp4"
ffmpeg -loglevel error -y -i "$out/reel.mp4" -c:v libwebp_anim -lossless 0 -q:v 80 -compression_level 6 -loop 0 \
  docs/showcase/hitomeguri-800x500.webp
