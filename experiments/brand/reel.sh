#!/bin/sh
# Makes the two showcase loops (ADR-0008, ADR-0009), each one day of 1日の光 at the site's own pace
# (24 s, 30 fps):
#   docs/showcase/hitomeguri-grid-1600x1000.avif   README: four pictures in one frame, one day together
#                                                  (seaside top-left, snow village top-right, canal
#                                                  bottom-left, festival bottom-right: the two pictures
#                                                  with a person sit on a diagonal so the rows do not
#                                                  split into "people" and "landscapes").
#   docs/showcase/hitomeguri-seaside-1536x960.avif Profile: the seaside alone.
# The day starts and ends on the original colours, so the loop needs no fade. The pictures are the
# site's own samples (app/src/samples.ts, assets/hero/roles.json): same person, placement, light
# blend and island roles as on the site.
# Animated AVIF (AV1 keeps only what changes between frames; colours here change slowly), not WebP:
# WebP stores every frame whole, so a full day at 30 fps would pass 30 MB, and the earlier WebP
# loops were sped up to 14 s at 7-10 fps, which the user found hurried and coarse. CRF 28: at
# full size it is hard to tell from the app's export. GitHub serves .avif as image/avif.
# High resolution (the pictures' own 1536x1024, exported at that size): GitHub stretches the README
# column to about 830 CSS px, about 1660 device px on high-density screens, where 960 px was soft.
# Usage from the repo root: sh experiments/brand/reel.sh
set -eu
out=app/test/results/showcase
avif="-c:v libsvtav1 -preset 4 -pix_fmt yuv420p -svtav1-params keyint=240 -crf 28 -loop 0 -f avif"
node app/test/showcase-render.mjs --size=1536x1024 "$out" festival=festival:day seaside=seaside:day snow=snow:day canal=canal:day
tile="crop=1536:960:0:32,scale=798:498:flags=lanczos"
ffmpeg -loglevel error -y -i "$out/seaside.mp4" -i "$out/snow.mp4" -i "$out/canal.mp4" -i "$out/festival.mp4" -filter_complex "\
[0:v]$tile[a];[1:v]$tile[b];[2:v]$tile[c];[3:v]$tile[d];\
[a][b][c][d]xstack=inputs=4:layout=0_0|802_0|0_502|802_502:fill=0x181818,format=yuv420p" \
  -c:v libx264 -crf 10 -pix_fmt yuv420p "$out/grid.mp4"
ffmpeg -loglevel error -y -i "$out/grid.mp4" $avif docs/showcase/hitomeguri-grid-1600x1000.avif
ffmpeg -loglevel error -y -i "$out/seaside.mp4" -vf "crop=1536:960:0:32" $avif docs/showcase/hitomeguri-seaside-1536x960.avif
