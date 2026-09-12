#!/bin/bash
# ══════════════════════════════════════════════════════════════
#  짐 싸기 — 프로그램·설정·데이터를 암호 건 묶음 하나로.
#  이 묶음 하나가 곧 백업이자 이사 짐이다. 인터넷 없이도 세울 수 있다.
#
#      backup-pack.sh core     프로그램 + 설정 + 회원·정산·기록 (날마다)
#      backup-pack.sh media    사진                             (가끔)
#      backup-pack.sh all      둘 다
#
#  ★묶고 나면 반드시 풀어서 확인한다. 확인 안 한 백업은 백업이 아니다.
#  묶음 속 생김새:  WHAT.txt · app/(프로그램·설정) · data/(사진 뺀 데이터)
# ══════════════════════════════════════════════════════════════
set -euo pipefail

APP="${APP:-/home/ada/riverhill-caddie}"
OUT="${OUT:-/home/ada/riverhill-backup}"
PASS="${PASS:-/home/ada/.riverhill-backup-pass}"
KEEP_CORE="${KEEP_CORE:-90}"
KEEP_MEDIA="${KEEP_MEDIA:-8}"
GPG=(gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$PASS")

log(){ echo "  $*"; }
die(){ echo "✗ $*" >&2; exit 1; }

[ -d "$APP" ] || die "앱 폴더가 없습니다: $APP"
[ -s "$PASS" ] || die "암호 파일이 없습니다: $PASS"
for c in zstd gpg rsync node tar; do command -v "$c" >/dev/null || die "$c 가 없습니다"; done
mkdir -p "$OUT"

STAMP=$(date +%Y%m%d-%H%M)
TMP=$(mktemp -d /tmp/rhpack.XXXXXX)
trap 'rm -rf "$TMP"' EXIT

# 회원·정산은 돌아가는 중에도 한 순간의 온전한 사본으로 뜬다
snapdb(){
  node -e '
    const {DatabaseSync}=require("node:sqlite");
    const d=new DatabaseSync(process.argv[1],{readOnly:true});
    d.exec("VACUUM INTO \x27"+process.argv[2]+"\x27");
    d.close();
  ' "$APP/data/app.db" "$1" 2>/dev/null
}

seal(){                                # seal <종류> <쌓아 둔 폴더> → 만든 파일
  local kind="$1" dir="$2"
  local f="$OUT/riverhill-$kind-$STAMP.tar.zst.gpg"
  tar -C "$dir" -cf - . | zstd -q -3 -c | "${GPG[@]}" --symmetric --cipher-algo AES256 -o "$f"
  echo "$f"
}

check(){                               # ★풀어서 확인한다
  local f="$1" kind="$2" v="$TMP/check"
  rm -rf "$v"; mkdir -p "$v"
  "${GPG[@]}" --decrypt "$f" 2>/dev/null | zstd -dq -c | tar -C "$v" -xf - \
    || die "묶음을 다시 못 풀었습니다 — 이 묶음은 못 씁니다"
  log "풀어서 확인: 파일 $(find "$v" -type f | wc -l) 개"
  if [ "$kind" = core ]; then
    [ -s "$v/app/.env" ]        || die "설정·열쇠가 묶음에 없습니다"
    [ -s "$v/app/src/server.mjs" ] || die "프로그램이 묶음에 없습니다"
    [ -d "$v/app/node_modules" ]   || die "부품(node_modules)이 묶음에 없습니다"
    [ -s "$v/data/app.db" ]     || die "회원 파일이 묶음에 없습니다"
    local t; t=$(node -e '
      const {DatabaseSync}=require("node:sqlite");
      const d=new DatabaseSync(process.argv[1],{readOnly:true});
      const r=d.prepare("SELECT count(*) c FROM sqlite_master WHERE type=\x27table\x27").get();
      const u=d.prepare("SELECT count(*) c FROM users").get();
      console.log(r.c+"표 · 회원 "+u.c+"명"); d.close();
    ' "$v/data/app.db" 2>/dev/null) || die "묶음 안의 회원 파일이 깨졌습니다"
    log "회원 파일 열어 봄: $t"
  fi
  rm -rf "$v"
}

prune(){
  local kind="$1" keep="$2" old
  old=$(ls -1t "$OUT"/riverhill-"$kind"-*.tar.zst.gpg 2>/dev/null | tail -n +$((keep+1)) || true)
  [ -z "$old" ] && return 0
  echo "$old" | xargs -r rm -f
  log "오래된 $kind 묶음 $(echo "$old" | wc -l) 개 걷음"
}

pack_core(){
  local s="$TMP/core"
  mkdir -p "$s/app" "$s/data"
  # 프로그램 — 이 데이터와 짝이 맞는 바로 그 판본이다. 부품까지 넣어 인터넷 없이도 서게 한다
  rsync -a --exclude '.git/' --exclude 'data/' --exclude 'data.bak-*' \
           --exclude '*.log' --exclude 'node_modules/.cache/' \
           "$APP/" "$s/app/"
  # 데이터 — 사진은 따로 싼다
  snapdb "$s/data/app.db" || die "회원 파일을 못 떴습니다"
  rsync -a --exclude 'users/' --exclude 'ingest-images/' \
           --exclude 'app.db' --exclude 'app.db-wal' --exclude 'app.db-shm' \
           "$APP/data/" "$s/data/"
  cat > "$s/WHAT.txt" <<INFO
리버힐 캐디 앱 — 알맹이 묶음 (프로그램 + 설정 + 데이터)
싼 때    : $(date '+%Y-%m-%d %H:%M:%S')
싼 곳    : $(hostname)
프로그램 : $(cd "$APP" && git rev-parse --short HEAD 2>/dev/null || echo 모름)
노드     : $(node -v)
생김새   : app/(프로그램·부품·.env) · data/(사진 뺀 데이터)
세우는 법: tools/backup-restore.sh <목적지> 로 푼다
INFO
  local f; f=$(seal core "$s")
  log "알맹이 묶음: $(basename "$f")  $(du -h "$f" | cut -f1)"
  check "$f" core
  prune core "$KEEP_CORE"
}

pack_media(){
  local s="$TMP/media" got=0 d
  mkdir -p "$s/data"
  for d in users ingest-images; do
    [ -d "$APP/data/$d" ] || continue
    rsync -a "$APP/data/$d" "$s/data/"; got=1
  done
  [ "$got" = 1 ] || { log "사진이 없습니다 — 건너뜁니다"; return 0; }
  printf '리버힐 캐디 앱 — 사진 묶음\n싼 때: %s\n든 것: data/users · data/ingest-images\n' \
    "$(date '+%Y-%m-%d %H:%M:%S')" > "$s/WHAT.txt"
  local f; f=$(seal media "$s")
  log "사진 묶음: $(basename "$f")  $(du -h "$f" | cut -f1)"
  check "$f" media
  prune media "$KEEP_MEDIA"
}

case "${1:-core}" in
  core)  pack_core ;;
  media) pack_media ;;
  all)   pack_core; pack_media ;;
  *)     die "쓰는 법: backup-pack.sh [core|media|all]" ;;
esac
log "쌓인 곳: $OUT  (지금 $(ls -1 "$OUT" 2>/dev/null | wc -l) 개 · $(du -sh "$OUT" 2>/dev/null | cut -f1))"
