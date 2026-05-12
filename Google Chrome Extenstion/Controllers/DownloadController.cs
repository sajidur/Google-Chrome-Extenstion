using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Google_Chrome_Extenstion.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class DownloadController : ControllerBase
    {
        [HttpPost]
        public async Task<IActionResult> Download([FromBody] DownloadRequest req)
        {
            if (!Directory.Exists(req.FolderPath))
            {
                Directory.CreateDirectory(req.FolderPath);
            }

            foreach (var file in req.Files)
            {
                using var client = new HttpClient();

                var bytes = await client.GetByteArrayAsync(file.Url);

                var path = Path.Combine(req.FolderPath, file.FileName);

                await System.IO.File.WriteAllBytesAsync(path, bytes);
            }

            return Ok(new
            {
                Success = true
            });
        }
    }
}
