const GMAIL_HOST = "mail.google.com";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "DOWNLOAD_GMAIL_ATTACHMENTS") {
        return false;
    }

    downloadGmailAttachments(message)
        .then(result => sendResponse({ ok: true, result }))
        .catch(error => {
            console.error(error);
            setBadge("ERR", "#b00020");
            sendResponse({ ok: false, error: error?.message || "Unknown error" });
        });

    return true;
});

async function downloadGmailAttachments({ tabId, keyword, folderPath }) {
    setBadge("RUN", "#1a73e8");

    const tab = await chrome.tabs.get(tabId);
    if (!isGmailUrl(tab.url)) {
        throw new Error("Open Gmail in the active tab, then try again.");
    }

    const cleanFolder = sanitizeFolder(folderPath);
    const searchUrl = buildGmailSearchUrl(keyword);

    await goToUrl(tabId, searchUrl, 4000);

    const rows = await collectSearchRows(tabId);
    if (!rows.length) {
        throw new Error(`No email rows found for "${keyword}". Make sure the label/search has results.`);
    }

    let downloaded = 0;
    const seenDownloads = new Set();

    for (let i = 0; i < rows.length; i++) {
        await goToUrl(tabId, searchUrl, 1800);

        const opened = await openSearchRow(tabId, rows[i].id, i);
        if (!opened) {
            console.warn("Could not open Gmail row", rows[i]);
            continue;
        }

        await delay(3500);
        const files = await scanAttachments(tabId);

        for (const file of files) {
            const key = `${file.url}||${file.fileName}`;
            if (seenDownloads.has(key)) continue;
            seenDownloads.add(key);

            const filename = cleanFolder ? `${cleanFolder}/${file.fileName}` : file.fileName;
            const downloadId = await startDownload(file.url, filename);
            if (downloadId !== null) {
                downloaded++;
            }
        }
    }

    setBadge(String(downloaded), downloaded > 0 ? "#137333" : "#b06000");

    return { rows: rows.length, downloaded };
}

function isGmailUrl(url) {
    try {
        return new URL(url).hostname === GMAIL_HOST;
    } catch (error) {
        return false;
    }
}

function buildGmailSearchUrl(keyword) {
    const searchQuery = `label:"${keyword}" has:attachment`;
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

async function runInTab(tabId, func, args = []) {
    const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func,
        args
    });

    return result?.result;
}

async function collectSearchRows(tabId) {
    return runInTab(tabId, async () => {
        const rowSelector = 'tr.zA, tr[role="row"]';
        const rows = [];
        const seen = new Set();

        const findScrollContainer = () => {
            const candidates = Array.from(document.querySelectorAll("div"))
                .filter(el => el.scrollHeight > el.clientHeight + 100)
                .sort((a, b) => b.clientHeight - a.clientHeight);
            return candidates[0] || document.scrollingElement || document.documentElement || document.body;
        };

        const getRowId = (row, index) => {
            const text = (row.innerText || "").replace(/\s+/g, " ").trim();
            return row.getAttribute("data-legacy-message-id")
                || row.getAttribute("data-legacy-thread-id")
                || row.getAttribute("data-thread-id")
                || row.id
                || `${text.slice(0, 160)}-${index}`;
        };

        const collect = () => {
            Array.from(document.querySelectorAll(rowSelector)).forEach((row, index) => {
                const text = (row.innerText || "").replace(/\s+/g, " ").trim();
                const rect = row.getBoundingClientRect();
                if (!text || rect.width < 250 || rect.height < 20) return;

                const id = getRowId(row, index);
                if (!seen.has(id)) {
                    seen.add(id);
                    rows.push({ id, text: text.slice(0, 160) });
                }
            });
        };

        const container = findScrollContainer();
        container.scrollTop = 0;

        for (let i = 0; i < 30; i++) {
            collect();
            const beforeScroll = container.scrollTop;
            container.scrollTop += Math.max(container.clientHeight, 700);
            await new Promise(resolve => setTimeout(resolve, 800));
            if (container.scrollTop === beforeScroll) break;
        }

        collect();
        container.scrollTop = 0;
        return rows;
    });
}

async function openSearchRow(tabId, rowId, rowIndex) {
    return runInTab(tabId, async (targetId, targetIndex) => {
        const rowSelector = 'tr.zA, tr[role="row"]';

        const findScrollContainer = () => {
            const candidates = Array.from(document.querySelectorAll("div"))
                .filter(el => el.scrollHeight > el.clientHeight + 100)
                .sort((a, b) => b.clientHeight - a.clientHeight);
            return candidates[0] || document.scrollingElement || document.documentElement || document.body;
        };

        const getRows = () => Array.from(document.querySelectorAll(rowSelector)).filter((row, index) => {
            const text = (row.innerText || "").replace(/\s+/g, " ").trim();
            const rect = row.getBoundingClientRect();
            if (!text || rect.width < 250 || rect.height < 20) return false;

            const id = row.getAttribute("data-legacy-message-id")
                || row.getAttribute("data-legacy-thread-id")
                || row.getAttribute("data-thread-id")
                || row.id
                || `${text.slice(0, 160)}-${index}`;

            row.dataset.attachmentDownloaderRowId = id;
            return true;
        });

        const container = findScrollContainer();
        container.scrollTop = 0;

        let row = null;
        for (let i = 0; i < 30; i++) {
            const rows = getRows();
            row = rows.find(item => item.dataset.attachmentDownloaderRowId === targetId);
            if (row) break;

            const beforeScroll = container.scrollTop;
            container.scrollTop += Math.max(container.clientHeight, 700);
            await new Promise(resolve => setTimeout(resolve, 600));
            if (container.scrollTop === beforeScroll) break;
        }

        row = row || getRows()[targetIndex];
        if (!row) return false;

        row.scrollIntoView({ block: "center" });
        await new Promise(resolve => setTimeout(resolve, 250));

        const openTarget = row.querySelector('td[role="link"], div[role="link"], a[href]') || row;
        openTarget.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        openTarget.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        openTarget.click();

        return true;
    }, [rowId, rowIndex]);
}

async function scanAttachments(tabId) {
    return runInTab(tabId, async () => {
        const files = [];
        const seen = new Set();
        const selector = '[download_url], a[href*="attid="], a[href*="attname="], a[href*="filename="], a[href*="export=download"]';

        const addFile = element => {
            const downloadUrl = element.getAttribute("download_url");
            const href = element.href || element.getAttribute("href") || "";
            let url = href;
            let fileName = "attachment";

            if (downloadUrl) {
                const urlStart = downloadUrl.search(/https?:\/\//);
                if (urlStart >= 0) {
                    url = downloadUrl.slice(urlStart);
                    const metadata = downloadUrl.slice(0, urlStart);
                    const firstColon = metadata.indexOf(":");
                    if (firstColon >= 0) {
                        fileName = metadata.slice(firstColon + 1).replace(/:$/, "");
                    }
                }
            } else {
                const downloadAttr = element.getAttribute("download");
                if (downloadAttr) {
                    fileName = downloadAttr;
                } else if (element.textContent) {
                    fileName = element.textContent.trim();
                }

                try {
                    const parsedUrl = new URL(href, location.href);
                    const attname = parsedUrl.searchParams.get("attname") || parsedUrl.searchParams.get("filename");
                    if (attname) {
                        fileName = decodeURIComponent(attname);
                    }
                    url = parsedUrl.toString();
                } catch (error) {
                    return;
                }
            }

            if (!url) return;

            fileName = (fileName || "attachment")
                .replace(/\s+/g, " ")
                .trim()
                .replace(/[\\/:*?"<>|]+/g, "_");

            const key = `${url}||${fileName}`;
            if (!seen.has(key)) {
                seen.add(key);
                files.push({ fileName, url });
            }
        };

        const collect = () => {
            Array.from(document.querySelectorAll(selector)).forEach(addFile);
        };

        const candidates = Array.from(document.querySelectorAll("div"))
            .filter(el => el.scrollHeight > el.clientHeight + 100)
            .sort((a, b) => b.clientHeight - a.clientHeight);
        const container = candidates[0] || document.scrollingElement || document.documentElement || document.body;

        for (let i = 0; i < 8; i++) {
            collect();
            const beforeScroll = container.scrollTop;
            container.scrollTop = container.scrollHeight;
            await new Promise(resolve => setTimeout(resolve, 900));
            if (container.scrollTop === beforeScroll) break;
        }

        collect();
        return files;
    });
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
