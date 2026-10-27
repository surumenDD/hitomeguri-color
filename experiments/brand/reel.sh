#!/bin/sh
# Makes the two showcase loops (ADR-0008, ADR-0009):
#   docs/showcase/hitomeguri-grid-960x600.webp  README: four pictures in one frame, one day together
#                                               (seaside top-left, snow village top-right, canal
#                                               bottom-left, festival bottom-right: the two pictures
#                                               with a person sit on a diagonal so the rows do not
#                                               split into "people" and "landscapes").
#   docs/showcase/hitomeguri-seaside-800x500.webp  Profile: the seaside alone, one day that loops
#                                               without a seam (the day starts and ends on the original
#                                               colours, so no dip to dark is needed), at 10 fps.
# The girls are cut-outs laid over backgrounds without people (assets/showcase/layer/, shipped as
# the samples お祭り and 海辺) with the person feature: placed close as in the pictures before they
# were separated, light blend 0.8.
# Each day of 1日の光 plays in 14 s (the app's default is 24 s; 9 s felt too fast): the grid at
# 7 fps, the single seaside at 10 fps. (An earlier two-part reel, seaside then festival, dipped to
# dark between parts; the user chose the seaside alone for the profile.) Animated WebP, not GIF: every frame
# recolours the whole picture, so GIF's LZW gains nothing; quality 85 (80 smoothed the pencil lines
# and the night faces when compared at full size).
# Usage from the repo root: sh experiments/brand/reel.sh
set -eu
out=app/test/results/showcase
D=14; R=7; Q=85
# The site's own samples (app/src/samples.ts and assets/hero/roles.json): same person, placement,
# light blend and island roles as on the site.
node app/test/showcase-render.mjs "$out" festival=festival:day seaside=seaside:day snow=snow:day canal=canal:day
day() { echo "setpts=PTS*$D/24,crop=960:600:0:20,scale=$1:flags=lanczos,fps=${2:-$R},trim=duration=$D,setpts=PTS-STARTPTS,format=yuv420p"; }
ffmpeg -loglevel error -y -i "$out/seaside.mp4" -i "$out/snow.mp4" -i "$out/canal.mp4" -i "$out/festival.mp4" -filter_complex "\
[0:v]$(day 478:298)[a];[1:v]$(day 478:298)[b];[2:v]$(day 478:298)[c];[3:v]$(day 478:298)[d];\
[a][b][c][d]xstack=inputs=4:layout=0_0|482_0|0_302|482_302:fill=0x181818,format=yuv420p[out]" \
  -map "[out]" -c:v libx264 -crf 10 -pix_fmt yuv420p "$out/grid.mp4"
ffmpeg -loglevel error -y -i "$out/seaside.mp4" -vf "$(day 800:500 10)" -c:v libx264 -crf 10 -pix_fmt yuv420p "$out/seaside-loop.mp4"
for name in grid:hitomeguri-grid-960x600 seaside-loop:hitomeguri-seaside-800x500; do
  ffmpeg -loglevel error -y -i "$out/${name%%:*}.mp4" -c:v libwebp_anim -lossless 0 -q:v $Q -compression_level 6 -loop 0 \
    "docs/showcase/${name#*:}.webp"
done
