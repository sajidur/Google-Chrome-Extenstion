using Microsoft.AspNetCore.Mvc.Filters;

namespace Google_Chrome_Extenstion.Controllers
{
    public class DownloadRequest
    {
        public string FolderPath { get; set; }
        public List<FileItem> Files { get; set; }
    }
}