#!/bin/bash
# Lädt die kostenlosen Piper-Stimmen (Deutsch: Thorsten, CC0; Englisch: LJSpeech, gemeinfrei) nach ./voices.
set -e
cd "$(dirname "$0")/.."
mkdir -p voices
B=https://huggingface.co/rhasspy/piper-voices/resolve/main
for v in de/de_DE/thorsten/high/de_DE-thorsten-high en/en_US/ljspeech/high/en_US-ljspeech-high; do
  n=$(basename "$v")
  for ext in onnx onnx.json; do
    [ -s "voices/$n.$ext" ] || curl -fsSL --retry 3 -o "voices/$n.$ext" "$B/$v.$ext"
  done
done
ls -1 voices
