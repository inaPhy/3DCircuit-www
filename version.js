(function exposeVersion(globalScope) {
    globalScope.APP_VERSION = Object.freeze({
        number: '2.86',
        date: '2026/08/17',
        storageFormat: '1.2',
        cache: '2.86.4'
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
