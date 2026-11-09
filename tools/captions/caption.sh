#!/usr/bin/env bash
# Burn the Flash ALOHA "Autonomous Skills" caption into a video.
#
#   TASK NAME
#   AUTONOMOUS 1X SPEED
#
# Bottom-left, two lines, Roboto Medium. Goal: visible if you look for it,
# but not distracting from the video. The letter edges get a slight blur
# so the text stays smooth when the browser shrinks the video in the grid,
# and a soft dark halo keeps it readable on white backgrounds.
# Text size and margins scale with min(width, height), so portrait and
# landscape videos get the same caption size.
#
# usage:
#   tools/captions/caption.sh INPUT OUTPUT "TASK NAME" [options]
#   Pass "" as TASK NAME for only the "AUTONOMOUS 1X SPEED" line (same spot).
#
# options:
#   --pre FILTERS    ffmpeg filters applied before captioning, with a trailing
#                    comma, e.g. "scale=1920:-2,fps=30,". Use scale=1920:-2 so
#                    the caption matches the other skill videos (1080p).
#   --ss SECONDS     start time to cut from
#   -t SECONDS       duration to keep
#   --crf N          x264 quality (default 20; the skill-* videos used 26)
#   --no-audio       drop the audio track
#   --blur-scale N   multiply the edge/halo blur (px) by N. Default: auto,
#                    min(w,h)/1080 of the input when --pre does not scale,
#                    else 1. Keeps 4K captions looking like the 1080p ones.
#
# Captions already on the site (static/videos/flash-aloha/):
#   shorts FOLD SHORTS | cups UNSTACK CUPS | battery INSERT BATTERY
#   table BUS TABLE | shirt FOLD SHIRT | skill-2491 LOAD DISHWASHER
#   skill-6270 PASS BUTTER | skill-6349 HELP PUT ON A JACKET
#   skill-6296 CATCH TOWEL | skill-6361 FLIP PANCAKE | toss-catch TOSS AND CATCH
# The skill-* videos are 1080p60, downscaled from the 4K iPhone originals:
#   caption.sh IMG_6296.MOV skill-6296.mp4 "CATCH TOWEL" --pre "scale=1920:-2:flags=lanczos,fps=60," --no-audio --crf 23
# toss-catch: caption.sh three.mp4 toss-catch.mp4 "TOSS AND CATCH" --pre "scale=1920:-2," --ss 1.5 -t 8
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Caption style. These are the values used for every video on the site.
SIZE=0.05        # font size as a fraction of min(w,h)
MARGIN=0.055     # left/bottom margin as a fraction of min(w,h)
WEIGHT=500       # fonts/roboto-400.ttf or fonts/roboto-500.ttf
EDGE=1.6         # gaussian blur sigma on the letter edges (px)
HALO_BLUR=7      # halo blur sigma (px)
HALO_GAIN=1.8    # halo mask boost before clipping
HALO_ALPHA=0.7   # halo opacity
TEXT_ALPHA=0.95  # text opacity
LINE2="AUTONOMOUS 1X SPEED"

[ $# -ge 3 ] || { sed -n '2,37p' "$0"; exit 1; }
IN="$1"; OUT="$2"; NAME="$3"; shift 3
PRE=""; SS=(); DUR=(); CRF=20; BS=""; AUDIO=(-map "0:a?" -c:a copy)
while [ $# -gt 0 ]; do
  case "$1" in
    --pre) PRE="$2"; shift 2 ;;
    --ss) SS=(-ss "$2"); shift 2 ;;
    -t) DUR=(-t "$2"); shift 2 ;;
    --crf) CRF="$2"; shift 2 ;;
    --no-audio) AUDIO=(-an); shift ;;
    --blur-scale) BS="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$BS" ]; then
  if [[ "$PRE" == *scale=* ]]; then BS=1
  else
    BS=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$IN" \
      | awk -F, '{m=($1<$2)?$1:$2; printf "%.4f", m/1080}')
  fi
fi
EDGE=$(awk "BEGIN{print $EDGE*$BS}"); HALO_BLUR=$(awk "BEGIN{print $HALO_BLUR*$BS}")

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# textfile= avoids ffmpeg escaping problems with the caption text
printf '%s' "$NAME" > "$TMP/l1.txt"
printf '%s' "$LINE2" > "$TMP/l2.txt"

F="$DIR/fonts/roboto-$WEIGHT.ttf"
fs="min(w\,h)*$SIZE"; x="min(w\,h)*$MARGIN"
a2="textfile=$TMP/l2.txt:fontsize=$fs:x=$x:y=h-min(w\,h)*$MARGIN-$fs"
a1="textfile=$TMP/l1.txt:fontsize=$fs:x=$x:y=h-min(w\,h)*$MARGIN-($fs)*2.3"
d="drawtext=fontfile=$F:fontcolor=white"
TEXT="$d:$a2"; [ -n "$NAME" ] && TEXT="$d:$a1,$d:$a2"

FILTER="[0:v]${PRE}format=yuv420p,split=3[base][r1][r2];\
[r1]drawbox=c=black:t=fill,$TEXT,format=gray,split[m0][m1];\
[m0]gblur=sigma=$EDGE[mt];\
[m1]gblur=sigma=$HALO_BLUR,lut=y='min(255\,val*$HALO_GAIN)'[mw];\
[r2]drawbox=c=black:t=fill,format=yuva420p,split[b1][b2];[b2]drawbox=c=white:t=fill[wh];\
[b1][mw]alphamerge,colorchannelmixer=aa=$HALO_ALPHA[sw];\
[wh][mt]alphamerge,colorchannelmixer=aa=$TEXT_ALPHA[tx];\
[base][sw]overlay[g1];[g1][tx]overlay,format=yuv420p[v]"

ffmpeg -nostdin -v error -y "${SS[@]}" "${DUR[@]}" -i "$IN" -filter_complex "$FILTER" \
  -map "[v]" "${AUDIO[@]}" -c:v libx264 -preset slow -crf "$CRF" \
  -pix_fmt yuv420p -movflags +faststart "$OUT"
echo "wrote $OUT"
