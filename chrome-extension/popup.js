const statusEl = document.getElementById("status");
const downloadBtn = document.getElementById("downloadBtn");

function setStatus(message) {
    statusEl.textContent = message || "";
}

document.getElementById("downloadBtn").addEventListener("click", async () => {
    const keyword = document.getElementById("label").value.trim();
    const folderPath = document.getElementById("folder").value.trim();
    const onlyNew = document.getElementById("onlyNew").checked;

    if (!keyword && !onlyNew) {
        alert("Enter a Gmail label/keyword, or check Only new/unread emails.");
        return;
    }

    downloadBtn.disabled = true;
    setStatus(`Starting Gmail search for ${keyword ? `"${keyword}"` : "new/unread emails"}...`);

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
