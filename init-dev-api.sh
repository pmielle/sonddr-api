#!/usr/bin/env bash
set -euo pipefail

docker build -t sonddr-api .

docker run -d --rm -p 3000:3000 --name sonddr-api \
	sonddr-api
