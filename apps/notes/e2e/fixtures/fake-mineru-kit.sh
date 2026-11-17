#!/bin/sh
# 假的 mineru-kit（测试用，单元测试和端到端共用）：认 --version、models verify / download、parse。
# CN_FAKE_MINERU_VERSION   --version 说的版本（默认 4.2.3）
# CN_FAKE_MIDDLE           parse 输出的 middle.json（原样拷过去）
# CN_FAKE_MINERU_FAIL      exit = 退出码 3；hang = 一直不结束；badjson = 写一份坏的 JSON
# CN_FAKE_MINERU_SLEEP     parse 每一步睡几秒（默认 0.3）
# 模型在 $HOME/.mineru/models/basic.ok（models download 写它，models verify 看它）；每次 parse 的参数记进 $HOME/mineru-parse.log
V="${CN_FAKE_MINERU_VERSION:-4.2.3}"
S="${CN_FAKE_MINERU_SLEEP:-0.3}"
case "$1" in
  --version)
    echo "MinerU version: $V"
    echo "Python version: 3.12.0"
    exit 0
    ;;
  models)
    case "$2" in
      verify)
        if [ -f "$HOME/.mineru/models/basic.ok" ]; then echo "MinerU-4_models_torch: ok"; exit 0; fi
        echo "MinerU-4_models_torch: missing" >&2
        exit 1
        ;;
      download)
        mkdir -p "$HOME/.mineru/models"
        for i in 1 2 3 4 5; do
          dd if=/dev/zero of="$HOME/.mineru/models/part$i" bs=1024 count=100 2>/dev/null
          printf 'Downloading models: %d%%|##   | %d/5\r' $((i * 20)) "$i" >&2
          sleep 0.2
        done
        touch "$HOME/.mineru/models/basic.ok"
        exit 0
        ;;
    esac
    exit 2
    ;;
  parse)
    echo "$*" >> "$HOME/mineru-parse.log"
    shift
    OUT=""
    while [ $# -gt 0 ]; do
      case "$1" in
        -o) OUT="$2"; shift ;;
        --remote|--remote-url|--api-key) echo "remote is not allowed in tests" >&2; exit 9 ;;
      esac
      shift
    done
    printf 'Loading weights: 100%%|##########| 961/961\n' >&2
    sleep "$S"
    printf 'Layout Predict:  50%%|#####     | 1/2\r' >&2
    sleep "$S"
    printf 'Layout Predict: 100%%|##########| 2/2\n' >&2
    case "$CN_FAKE_MINERU_FAIL" in
      exit) echo "RuntimeError: out of memory" >&2; exit 3 ;;
      hang) sleep 600; exit 0 ;;
      badjson) echo '{"pages": [' > "$OUT"; exit 0 ;;
    esac
    printf 'OCR-det:  60%%|######    | 3/5\r' >&2
    sleep "$S"
    cp "$CN_FAKE_MIDDLE" "$OUT"
    echo "Parsed 1 input(s)."
    exit 0
    ;;
esac
echo "unknown command: $1" >&2
exit 2
