#!/bin/sh
# Makes the two showcase loops (ADR-0008, ADR-0009):
#   docs/showcase/hitomeguri-grid-960x600.webp  README: four pictures in one frame, one day together
#                                               (seaside top-left, snow village top-right, canal
#                                               bottom-left, festival bottom-right: the two pictures
#                                               with a person sit on a diagonal so the rows do not
#                                               split into "people" and "landscapes").
#   docs/showcase/hitomeguri-reel-800x500.webp  Profile: the seaside, then the festival, large.
# The girls are cut-outs laid over backgrounds without people (assets/showcase/layer/) with the
# person feature: placed close as in the pictures before they were separated, light blend 0.8.
# Each day of 1日の光 plays in 14 s at 7 fps (the app's default is 24 s; 9 s felt too fast). The
# reel dips to dark for 0.8 s between parts and at the loop point, so there is no seam (a
# cross-fade between different compositions looked muddy). Animated WebP, not GIF: every frame
# recolours the whole picture, so GIF's LZW gains nothing; quality 85 (80 smoothed the pencil lines
# and the night faces when compared at full size).
# Usage from the repo root: sh experiments/brand/reel.sh
set -eu
out=app/test/results/showcase
L=assets/showcase/layer
D=14; R=7; F=0.8; Q=85
fest="festival=$L/festival.png:day#foreground=$L/girl-yukata.png&x=0.5&y=1.26&size=1.05&blend=0.8"
sea="seaside=$L/seaside.png:day#foreground=$L/girl.png&x=0.76&y=1.6&size=1.2&blend=0.8"
node app/test/showcase-render.mjs "$out" "$fest" "$sea" snow=snow:day canal=canal:day
day() { echo "setpts=PTS*$D/24,crop=960:600:0:20,scale=$1:flags=lanczos,fps=$R,trim=duration=$D,setpts=PTS-STARTPTS,format=yuv420p"; }
ffmpeg -loglevel error -y -i "$out/seaside.mp4" -i "$out/snow.mp4" -i "$out/canal.mp4" -i "$out/festival.mp4" -filter_complex "\
[0:v]$(day 478:298)[a];[1:v]$(day 478:298)[b];[2:v]$(day 478:298)[c];[3:v]$(day 478:298)[d];\
[a][b][c][d]xstack=inputs=4:layout=0_0|482_0|0_302|482_302:fill=0x181818,format=yuv420p[out]" \
  -map "[out]" -c:v libx264 -crf 10 -pix_fmt yuv420p "$out/grid.mp4"
ffmpeg -loglevel error -y -i "$out/seaside.mp4" -i "$out/festival.mp4" -i "$out/seaside.mp4" -filter_complex "\
[0:v]$(day 800:500)[a];[1:v]$(day 800:500)[b];[2:v]$(day 800:500)[c];\
[a][b]xfade=transition=fadeblack:duration=$F:offset=$(awk "BEGIN{print $D - $F}")[ab];\
[ab][c]xfade=transition=fadeblack:duration=$F:offset=$(awk "BEGIN{print 2*$D - 2*$F}"),trim=start=$F:end=$(awk "BEGIN{print 2*$D - $F}"),setpts=PTS-STARTPTS[out]" \
  -map "[out]" -c:v libx264 -crf 10 -pix_fmt yuv420p "$out/reel.mp4"
for name in grid:hitomeguri-grid-960x600 reel:hitomeguri-reel-800x500; do
  ffmpeg -loglevel error -y -i "$out/${name%%:*}.mp4" -c:v libwebp_anim -lossless 0 -q:v $Q -compression_level 6 -loop 0 \
    "docs/showcase/${name#*:}.webp"
done
