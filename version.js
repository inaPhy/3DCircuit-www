(function exposeVersion(globalScope) {
    globalScope.APP_VERSION = Object.freeze({
        number: '3.01',
        date: '2026/11/06',
        storageFormat: '1.3',
        cache: '3.01.0'
    });

    if (!globalScope.document) return;
    globalScope.document.addEventListener('DOMContentLoaded', () => {
        globalScope.document.querySelectorAll('[data-app-version]').forEach(element => {
            element.textContent = globalScope.APP_VERSION.number;
        });

        const titlePrefix = globalScope.document.documentElement.dataset.versionTitle;
        if (titlePrefix) {
            globalScope.document.title = `${titlePrefix} (ver${globalScope.APP_VERSION.number})`;
        }
    });
})(typeof self !== 'undefined' ? self : globalThis);
