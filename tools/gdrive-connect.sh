#!/bin/bash
# ══════════════════════════════════════════════════════════════
#  구글 드라이브를 '집 밖 한 벌' 자리로 잇는다. 한 번만 하면 된다.
#  이 컴퓨터 화면에서 실행하면 브라우저가 열리고, 구글에서 '허용'만 누르면 끝.
#  권한은 'rclone 이 만든 파일'로만 좁힌다 — 드라이브의 딴 파일은 못 본다.
# ══════════════════════════════════════════════════════════════
set -uo pipefail
RCLONE=/home/ada/bin/rclone
REMOTE=gdrive
FOLDER="${FOLDER:-리버힐백업}"
OFFCONF=/home/ada/.riverhill-offsite
OUT=/home/ada/riverhill-backup

echo
echo "════════════════════════════════════════════"
echo "  구글 드라이브에 백업 한 벌 두기"
echo "════════════════════════════════════════════"
echo
[ -x "$RCLONE" ] || { echo "  ✗ rclone 이 없습니다"; read -rp "  엔터를 누르면 닫힙니다"; exit 1; }

if "$RCLONE" listremotes 2>/dev/null | grep -q "^$REMOTE:"; then
  echo "  이미 이어져 있습니다. 잘 되는지만 봅니다."
else
  echo "  곧 브라우저가 열립니다."
  echo "  구글 계정을 고르고 '허용'을 눌러 주십시오."
  echo "  (창이 안 열리면 화면에 뜨는 주소를 브라우저에 붙여 넣으십시오)"
  echo
  "$RCLONE" config create "$REMOTE" drive scope=drive.file || {
    echo; echo "  ✗ 이어지지 않았습니다. 다시 해 보십시오."
    read -rp "  엔터를 누르면 닫힙니다"; exit 1; }
fi

echo
echo "  ── 잘 되는지 봅니다"
"$RCLONE" mkdir "$REMOTE:$FOLDER" 2>/dev/null
T=$(mktemp); echo "리버힐 백업 자리 확인 $(date '+%F %T')" > "$T"
if "$RCLONE" copyto "$T" "$REMOTE:$FOLDER/_확인.txt" 2>&1; then
  echo "  ◎ 구글 드라이브 '$FOLDER' 폴더에 글을 써 봤습니다"
else
  echo "  ✗ 쓰지 못했습니다"; rm -f "$T"; read -rp "  엔터를 누르면 닫힙니다"; exit 1
fi
rm -f "$T"

echo "$REMOTE:$FOLDER" > "$OFFCONF"
echo "  ◎ 앞으로 새벽마다 여기로 한 벌씩 갑니다"

echo
echo "  ── 지금 쌓여 있는 것을 먼저 보냅니다 (좀 걸립니다)"
"$RCLONE" copy "$OUT" "$REMOTE:$FOLDER" --include 'riverhill-*.tar.zst.gpg' \
  --transfers 2 --progress 2>&1 | tail -3
n=$("$RCLONE" lsf "$REMOTE:$FOLDER" --include 'riverhill-*.tar.zst.gpg' 2>/dev/null | wc -l)
echo
echo "  ════════════════════════════════════════"
echo "   다 됐습니다 — 구글 드라이브에 $n 개 있습니다"
echo "   드라이브에서 '$FOLDER' 폴더를 열어 보시면 눈으로 확인됩니다"
echo "  ════════════════════════════════════════"
echo
read -rp "  엔터를 누르면 닫힙니다"
