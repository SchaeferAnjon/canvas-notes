#!/bin/sh
# 假的 uv（测试装 MinerU 用，单元测试和端到端共用）：
#   venv --python 3.12 <venv>                 建 <venv>/bin/python，Python 记在 UV_PYTHON_INSTALL_DIR
#   pip install --python <py> mineru==<v>     往 UV_CACHE_DIR 写几块「下载」、打百分比，再把假的 mineru-kit 拷进 venv
# CN_FAKE_MINERU_KIT：假的 mineru-kit 在哪；CN_FAKE_UV_FAIL=pip 时 pip 退出码 1；CN_FAKE_UV_SLEEP 每块睡几秒（默认 0.2）
# 每次的参数记进 $HOME/uv.log
echo "$*" >> "$HOME/uv.log"
S="${CN_FAKE_UV_SLEEP:-0.2}"
case "$1" in
  venv)
    V="$4"
    mkdir -p "$V/bin" "$UV_PYTHON_INSTALL_DIR/cpython-3.12-macos"
    printf '#!/bin/sh\nexit 0\n' > "$V/bin/python"
    chmod +x "$V/bin/python"
    echo "Using CPython 3.12.0" >&2
    echo "Creating virtual environment at: $V" >&2
    exit 0
    ;;
  pip)
    if [ "$CN_FAKE_UV_FAIL" = "pip" ]; then echo "error: Failed to download torch: network unreachable" >&2; exit 1; fi
    PY="$4"
    mkdir -p "$UV_CACHE_DIR"
    for i in 1 2 3 4 5 6; do
      dd if=/dev/zero of="$UV_CACHE_DIR/wheel$i" bs=1024 count=100 2>/dev/null
      printf 'Downloading torch: %d%%|###  | %d/6\n' $((i * 16)) "$i" >&2
      sleep "$S"
    done
    BIN="$(dirname "$PY")"
    cp "$CN_FAKE_MINERU_KIT" "$BIN/mineru-kit"
    chmod +x "$BIN/mineru-kit"
    echo "Installed 1 package" >&2
    exit 0
    ;;
esac
echo "unknown: $1" >&2
exit 2
