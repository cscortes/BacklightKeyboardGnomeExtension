/** Minimal ExtensionPreferences stub for headless prefs smoke test. */
export class ExtensionPreferences {
    constructor() {
        this.metadata = null;
    }

    getSettings() {
        throw new Error('getSettings must be assigned on the smoke-test instance');
    }
}

export function gettext(s) {
    return s;
}
