#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .local
if [[ ! -f .local/host-token ]]; then
  (umask 077; node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" > .local/host-token)
fi
adb shell 'mkdir -p /home/arduino/ArduinoApps/openchat/python /home/arduino/ArduinoApps/openchat/assets /home/arduino/ArduinoApps/openchat/.cache'
adb push board/python/main.py board/python/room.py /home/arduino/ArduinoApps/openchat/python/
adb push index.html renderer.js style.css /home/arduino/ArduinoApps/openchat/assets/
adb push node_modules/socket.io-client/dist/socket.io.min.js /home/arduino/ArduinoApps/openchat/assets/
adb push .local/host-token /home/arduino/ArduinoApps/openchat/.cache/openchat-host-token
adb shell 'chmod 600 /home/arduino/ArduinoApps/openchat/.cache/openchat-host-token; cd /home/arduino/ArduinoApps/openchat && arduino-app-cli app restart .'
