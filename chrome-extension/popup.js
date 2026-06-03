const statusEl = document.getElementById("status");
const downloadBtn = document.getElementById("downloadBtn");

function setStatus(message) {
    statusEl.textContent = message || "";
}

document.getElementById("downloadBtn").addEventListener("click", async () => {
    const keyword = document.getElementById("label").value.trim();
    const searchType = document.getElementById("searchType").value;
    const folderPath = document.getElementById("folder").value.trim();
    const onlyNew = document.getElementById("onlyNew").checked;

    if (!keyword && !onlyNew) {
        alert("Enter search text, or check Only new/unread emails.");
        return;
    }

    downloadBtn.disabled = true;
    const searchLabel = keyword ? `${searchType} "${keyword}"` : "new/unread emails";
    setStatus(`Starting Gmail search for ${searchLabel}...`);

    try {
        const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true
        });

        if (!tab || !tab.id) {
            alert("Unable to find the active tab.");
            setStatus("");
            return;
        }

        const response = await chrome.runtime.sendMessage({
            type: "DOWNLOAD_GMAIL_ATTACHMENTS",
            tabId: tab.id,
            keyword,
            searchType,
            folderPath,
            onlyNew
        });

        if (!response?.ok) {
            throw new Error(response?.error || "The background job failed.");
        }

        setStatus("Started. Keep the Gmail tab open; the extension badge will show RUN, ERR, or the download count.");
    } catch (error) {
        console.error(error);
        alert(error?.message || "Unable to start the attachment download job.");
        setStatus("");
    } finally {
        downloadBtn.disabled = false;
    }
});
