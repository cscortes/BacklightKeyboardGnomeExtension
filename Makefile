# Keyboard Backlight Scheduler — development targets
UUID := $(shell grep -Po '(?<="uuid": ")[^"]+' metadata.json)

.PHONY: help dev-setup validate install reload dev

help:
	@echo "Keyboard Backlight Scheduler — make targets"
	@echo ""
	@echo "  make dev-setup   Install system + npm deps and verify environment"
	@echo "  make validate    ESLint + syntax check + schedule tests + prefs smoke test"
	@echo "  make install     validate, then deploy to ~/.local/share/gnome-shell/extensions/"
	@echo "  make reload      install + disable/enable extension (prefs.js changes only)"
	@echo "  make dev         Nested devkit GNOME Shell dev loop — auto reinstall + relaunch on save"
	@echo ""
	@echo "UUID: $(UUID)"

dev-setup:
	sudo dnf install -y glib2-devel nodejs npm gjs mutter-devkit
	npm install --no-fund --no-audit
	chmod +x install.sh validate-js.sh dev-reload.sh tools/prefs-smoke.js tools/check-syntax.js tools/schedule-logic-test.js tools/dev-devkit.js

validate:
	./validate-js.sh

install:
	./install.sh

reload:
	./dev-reload.sh

dev:
	npm run dev
