# Keyboard Backlight Scheduler — development targets
UUID := $(shell grep -Po '(?<="uuid": ")[^"]+' metadata.json)

.PHONY: help dev-setup validate install reload dev pack ci

help:
	@echo "Keyboard Backlight Scheduler — make targets"
	@echo ""
	@echo "  make dev-setup   Install system + npm deps and verify environment"
	@echo "  make validate    ESLint + syntax check + schedule tests + prefs smoke test"
	@echo "  make ci          validate + metadata/schema/hygiene + pack zip inspect (GitHub Actions)"
	@echo "  make install     validate, then deploy to ~/.local/share/gnome-shell/extensions/"
	@echo "  make reload      install + disable/enable extension (prefs.js changes only)"
	@echo "  make dev         Nested devkit GNOME Shell dev loop — auto reinstall + relaunch on save"
	@echo "  make pack        Build a .shell-extension.zip in dist/ for gnome-extensions install / extensions.gnome.org"
	@echo ""
	@echo "UUID: $(UUID)"

dev-setup:
	sudo dnf install -y glib2-devel nodejs npm gjs mutter-devkit
	npm install --no-fund --no-audit
	chmod +x install.sh validate-js.sh dev-reload.sh tools/prefs-smoke.js tools/check-syntax.js tools/schedule-logic-test.js tools/dev-devkit.js

validate:
	./validate-js.sh

ci: validate
	./tools/ci-verify.sh

install:
	./install.sh

reload:
	./dev-reload.sh

dev:
	npm run dev

pack: validate
	mkdir -p dist
	gnome-extensions pack . \
		--extra-source=hwDetect.js \
		--extra-source=scheduleLogic.js \
		--extra-source=LICENSE \
		-o dist -f
	@echo "Built dist/$(UUID).shell-extension.zip"
