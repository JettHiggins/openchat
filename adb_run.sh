#!/bin/bash

echo "Setting up ADB Shell"

adb devices
adb forward tcp:7000 tcp:7000

adb shell
