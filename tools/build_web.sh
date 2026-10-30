#!/bin/bash
# Assemble the web game into build/www (assets already converted there)
set -e
ROOT=/home/claude/hw
mkdir -p $ROOT/build/www/js
cp $ROOT/src/web/index.html $ROOT/build/www/index.html
# concatenate sources in dependency order
cat $ROOT/src/js/core.js $ROOT/src/js/input.js $(ls $ROOT/src/js/[0-9]*.js 2>/dev/null | sort) $ROOT/src/js/main.js > $ROOT/build/www/js/game.js
node --check $ROOT/build/www/js/game.js && echo "game.js OK ($(wc -c < $ROOT/build/www/js/game.js) bytes)"
