const GMAIL_HOST = "mail.google.com";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "DOWNLOAD_GMAIL_ATTACHMENTS") {
        startGmailJob(message)
            .then(result => sendResponse({ ok: true, result }))
            .catch(error => {
                console.error(error);
                setBadge("ERR", "#b00020");
                sendResponse({ ok: false, error: error?.message || "Unknown error" });
            });

        return true;
    }

    if (message?.type === "DOWNLOAD_ATTACHMENT_FILE") {
        startDownload(message.url, message.filename)
            .then(downloadId => sendResponse({ ok: downloadId !== null, downloadId }))
            .catch(error => {
                console.error(error);
                sendResponse({ ok: false, error: error?.message || "Download failed" });
            });

        return true;
    }

    if (message?.type === "GMAIL_JOB_STATUS") {
        if (message.status === "running") {
            setBadge("RUN", "#1a73e8");
        } else if (message.status === "done") {
            setBadge(String(message.downloaded || 0), message.downloaded > 0 ? "#137333" : "#b06000");
        } else if (message.status === "error") {
            setBadge("ERR", "#b00020");
        }

        return false;
    }

    return false;
});

async function startGmailJob({ tabId, keyword, searchType = "keyword", folderPath, onlyNew }) {
    const tab = await chrome.tabs.get(tabId);
    if (!isGmailUrl(tab.url)) {
        throw new Error("Open Gmail in the active tab, then try again.");
    }

    const searchUrl = buildGmailSearchUrl(keyword, searchType, onlyNew);
    await goToUrl(tabId, searchUrl, 4000);

    await chrome.scripting.executeScript({
        target: { tabId },
        files: ["gmail-worker.js"]
    });

    await chrome.tabs.sendMessage(tabId, {
        type: "START_GMAIL_ATTACHMENT_JOB",
        keyword,
        searchType,
        onlyNew,
        folderPath: sanitizeFolder(folderPath),
        searchUrl
    });

    setBadge("RUN", "#1a73e8");
    return { started: true };
}

function isGmailUrl(url) {
    try {
        return new URL(url).hostname === GMAIL_HOST;
    } catch (error) {
        return false;
    }
}

function buildGmailSearchUrl(keyword, searchType, onlyNew) {
    const parts = [];

    if (keyword) {
        if (searchType === "label") {
            parts.push(`label:"${keyword}"`);
        } else {
            parts.push(keyword);
        }
    }

    if (onlyNew) {
        parts.push("is:unread");
    }

    parts.push("has:attachment");

    const searchQuery = parts.join(" ");
    return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(searchQuery)}`;
}

function sanitizeFolder(folderPath) {
    return (folderPath || "")
        .replace(/\\/g, "/")
        .replace(/^\/+|\/+$/g, "")
        .replace(/[<>:"|?*]+/g, "_");
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForTabLoad(tabId, timeoutMs = 15000) {
    return new Promise(resolve => {
        let settled = false;
        const timeoutId = setTimeout(() => finish(), timeoutMs);

        function finish() {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            chrome.tabs.onUpdated.removeListener(onUpdated);
            resolve();
        }

        function onUpdated(updatedTabId, changeInfo) {
            if (updatedTabId === tabId && changeInfo.status === "complete") {
                finish();
            }
        }

        chrome.tabs.onUpdated.addListener(onUpdated);
    });
}

async function goToUrl(tabId, url, settleMs) {
    const currentTab = await chrome.tabs.get(tabId);
    let needsFullLoadWait = true;

    try {
        const currentUrl = new URL(currentTab.url);
        const nextUrl = new URL(url);
        needsFullLoadWait = currentUrl.origin !== nextUrl.origin || currentUrl.pathname !== nextUrl.pathname;
    } catch (error) {
        needsFullLoadWait = true;
    }

    await chrome.tabs.update(tabId, { url });
    if (needsFullLoadWait) {
        await waitForTabLoad(tabId);
    }
    await delay(settleMs);
}

function startDownload(url, filename) {
    return new Promise(resolve => {
        chrome.downloads.download({ url, filename, saveAs: false }, downloadId => {
            if (chrome.runtime.lastError) {
                console.error("Download failed", filename, chrome.runtime.lastError.message);
                resolve(null);
                return;
            }

            resolve(downloadId);
        });
    });
}

function setBadge(text, color) {
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
}
