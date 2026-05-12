const statusEl = document.getElementById("status");
const downloadBtn = document.getElementById("downloadBtn");

function setStatus(message) {
    statusEl.textContent = message || "";
}

document.getElementById("downloadBtn").addEventListener("click", async () => {
    const keyword = document.getElementById("label").value.trim();
    const folderPath = document.getElementById("folder").value.trim();

    if (!keyword) {
        alert("Enter a Gmail label or search keyword first.");
        return;
    }

    downloadBtn.disabled = true;
    setStatus(`Starting Gmail search for "${keyword}"...`);

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
            folderPath
        });

        if (!response?.ok) {
            throw new Error(response?.error || "The background job failed.");
        }

        setStatus(`Done. Started ${response.result.downloaded} download(s) from ${response.result.rows} email(s).`);
    } catch (error) {
        console.error(error);
        alert(error?.message || "Unable to start the attachment download job.");
        setStatus("");
    } finally {
        downloadBtn.disabled = false;
    }
});
