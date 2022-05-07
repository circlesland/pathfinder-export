#!/bin/bash

echo "Installing 'pathfinder-export' dependencies .."
npm i

echo " * compiling typescript .."
npx --no-install tsc || exit