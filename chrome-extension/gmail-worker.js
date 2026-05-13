(() => {
    if (window.__gmailAttachmentDownloaderInstalled) {
        return;
    }

    window.__gmailAttachmentDownloaderInstalled = true;
    window.__gmailAttachmentDownloaderRunning = false;

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type !== "START_GMAIL_ATTACHMENT_JOB") {
            return false;
        }

        if (window.__gmailAttachmentDownloaderRunning) {
            sendResponse({ ok: false, error: "A Gmail attachment job is already running." });
            return false;
        }

        window.__gmailAttachmentDownloaderRunning = true;
        sendResponse({ ok: true, started: true });

        runJob(message)
            .then(result => console.log("Gmail attachment downloader finished", result))
            .catch(error => {
                console.error(error);
                chrome.runtime.sendMessage({
                    type: "GMAIL_JOB_STATUS",
                    status: "error",
                    error: error?.message || "Unknown error"
                });
            })
            .finally(() => {
                window.__gmailAttachmentDownloaderRunning = false;
            });

        return false;
    });

    async function runJob({ keyword, onlyNew, folderPath, searchUrl }) {
        chrome.runtime.sendMessage({ type: "GMAIL_JOB_STATUS", status: "running" });

        await navigateToSearch(searchUrl);
        const rows = await collectSearchRows();
        if (!rows.length) {
            const description = keyword
                ? `${onlyNew ? "new/unread " : ""}emails for "${keyword}"`
                : "new/unread emails";
            throw new Error(`No email rows found for ${description}.`);
        }

        let downloaded = 0;
        const seenDownloads = new Set();

        for (let i = 0; i < rows.length; i++) {
            await navigateToSearch(searchUrl);

            const opened = await openSearchRow(rows[i].id, i);
            if (!opened) {
                console.warn("Could not open Gmail search row", rows[i]);
                continue;
            }

            await delay(3500);
            const files = await scanAttachments();

            for (const file of files) {
                const key = `${file.url}||${file.fileName}`;
                if (seenDownloads.has(key)) continue;
                seenDownloads.add(key);

                const filename = folderPath ? `${folderPath}/${file.fileName}` : file.fileName;
                const response = await chrome.runtime.sendMessage({
                    type: "DOWNLOAD_ATTACHMENT_FILE",
                    url: file.url,
                    filename
                });

                if (response?.ok) {
                    downloaded++;
                }
            }
        }

        chrome.runtime.sendMessage({
            type: "GMAIL_JOB_STATUS",
            status: "done",
            downloaded,
            rows: rows.length
        });

        return { downloaded, rows: rows.length };
    }

    async function navigateToSearch(searchUrl) {
        const nextUrl = new URL(searchUrl);

        if (location.origin === nextUrl.origin && location.pathname === nextUrl.pathname) {
            location.hash = nextUrl.hash;
        } else {
            location.href = searchUrl;
        }

        await waitForGmailIdle(2500);
    }

    async function waitForGmailIdle(timeoutMs) {
        await delay(timeoutMs);

        const startedAt = Date.now();
        while (Date.now() - startedAt < 8000) {
            if (document.querySelector('tr.zA, tr[role="row"], [download_url]')) {
                return;
            }
            await delay(500);
        }
    }

    async function collectSearchRows() {
        const rowSelector = 'tr.zA, tr[role="row"]';
        const rows = [];
        const seen = new Set();
        const container = findScrollContainer();
        container.scrollTop = 0;

        const collect = () => {
            Array.from(document.querySelectorAll(rowSelector)).forEach((row, index) => {
                const text = getCleanText(row);
                const rect = row.getBoundingClientRect();
                if (!text || rect.width < 250 || rect.height < 20) return;

                const id = getRowId(row, index);
                if (!seen.has(id)) {
                    seen.add(id);
                    rows.push({ id, text: text.slice(0, 160) });
                }
            });
        };

        for (let i = 0; i < 35; i++) {
            collect();
            const beforeScroll = container.scrollTop;
            container.scrollTop += Math.max(container.clientHeight, 700);
            await delay(800);
            if (container.scrollTop === beforeScroll) break;
        }

        collect();
        container.scrollTop = 0;
        return rows;
    }

    async function openSearchRow(rowId, rowIndex) {
        const container = findScrollContainer();
        container.scrollTop = 0;

        let row = null;
        for (let i = 0; i < 35; i++) {
            const rows = getVisibleRows();
            row = rows.find(item => item.dataset.attachmentDownloaderRowId === rowId);
            if (row) break;

            const beforeScroll = container.scrollTop;
            container.scrollTop += Math.max(container.clientHeight, 700);
            await delay(600);
            if (container.scrollTop === beforeScroll) break;
        }

        row = row || getVisibleRows()[rowIndex];
        if (!row) return false;

        row.scrollIntoView({ block: "center" });
        await delay(250);

        const openTarget = row.querySelector('td[role="link"], div[role="link"], a[href]') || row;
        openTarget.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        openTarget.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        openTarget.click();
        return true;
    }

    function getVisibleRows() {
        return Array.from(document.querySelectorAll('tr.zA, tr[role="row"]')).filter((row, index) => {
            const text = getCleanText(row);
            const rect = row.getBoundingClientRect();
            if (!text || rect.width < 250 || rect.height < 20) return false;

            row.dataset.attachmentDownloaderRowId = getRowId(row, index);
            return true;
        });
    }

    async function scanAttachments() {
        const filesByName = new Map();
        const selector = '[download_url], a[href*="attid="], a[href*="attname="], a[href*="filename="], a[href*="export=download"]';
        const container = findScrollContainer();

        const collect = () => {
            Array.from(document.querySelectorAll(selector)).forEach(element => {
                const file = getAttachmentFile(element);
                if (!file) return;

                const key = file.fileName.toLowerCase();
                const existing = filesByName.get(key);
                if (!existing || file.source === "download_url") {
                    filesByName.set(key, file);
                }
            });
        };

        for (let i = 0; i < 10; i++) {
            collect();
            const beforeScroll = container.scrollTop;
            container.scrollTop = container.scrollHeight;
            await delay(900);
            if (container.scrollTop === beforeScroll) break;
        }

        collect();
        return Array.from(filesByName.values()).map(({ fileName, url }) => ({ fileName, url }));
    }

    function getAttachmentFile(element) {
        const downloadUrl = element.getAttribute("download_url");
        const href = element.href || element.getAttribute("href") || "";
        let url = href;
        let fileName = "attachment";

        if (downloadUrl) {
            const urlStart = downloadUrl.search(/https?:\/\//);
            if (urlStart < 0) return null;

            url = downloadUrl.slice(urlStart);
            const metadata = downloadUrl.slice(0, urlStart);
            const firstColon = metadata.indexOf(":");
            if (firstColon >= 0) {
                fileName = metadata.slice(firstColon + 1).replace(/:$/, "");
            }
        } else {
            if (!href) return null;

            let parsedUrl;
            try {
                parsedUrl = new URL(href, location.href);
            } catch (error) {
                return null;
            }

            const isOriginalDownload = parsedUrl.searchParams.get("disp") === "safe"
                || parsedUrl.searchParams.get("export") === "download"
                || element.hasAttribute("download");

            if (!isOriginalDownload) {
                return null;
            }

            const downloadAttr = element.getAttribute("download");
            if (downloadAttr) {
                fileName = downloadAttr;
            } else if (element.textContent) {
                fileName = element.textContent.trim();
            }

            const attname = parsedUrl.searchParams.get("attname") || parsedUrl.searchParams.get("filename");
            if (attname) {
                fileName = decodeURIComponent(attname);
            }
            url = parsedUrl.toString();
        }

        if (!url) return null;

        fileName = (fileName || "attachment")
            .replace(/\s+/g, " ")
            .trim()
            .replace(/[\\/:*?"<>|]+/g, "_");

        return { fileName, url, source: downloadUrl ? "download_url" : "download_link" };
    }

    function getRowId(row, index) {
        const text = getCleanText(row);
        return row.getAttribute("data-legacy-message-id")
            || row.getAttribute("data-legacy-thread-id")
            || row.getAttribute("data-thread-id")
            || row.id
            || `${text.slice(0, 160)}-${index}`;
    }

    function getCleanText(element) {
        return (element.innerText || "").replace(/\s+/g, " ").trim();
    }

    function findScrollContainer() {
        const candidates = Array.from(document.querySelectorAll("div"))
            .filter(el => el.scrollHeight > el.clientHeight + 100)
            .sort((a, b) => b.clientHeight - a.clientHeight);

        return candidates[0] || document.scrollingElement || document.documentElement || document.body;
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
})();
