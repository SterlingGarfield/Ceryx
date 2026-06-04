using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Ceryx.Agent.Core;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class FileTransferApiTests : IClassFixture<RemoteControlTransportFactory>
{
    private readonly RemoteControlTransportFactory _factory;

    public FileTransferApiTests(RemoteControlTransportFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task FilesUploadEndpoint_StoresUploadedFileOnDisk()
    {
        var (client, fileId, storedPath) = await UploadSampleFileAsync();

        Assert.False(string.IsNullOrWhiteSpace(fileId));
        Assert.True(File.Exists(storedPath));
        Assert.Equal("hello file", await File.ReadAllTextAsync(storedPath));
    }

    [Fact]
    public async Task FilesListEndpoint_ReturnsUploadedFileEntry()
    {
        var (client, fileId, storedPath) = await UploadSampleFileAsync();

        var response = await client.GetAsync("/api/v1/files/list?path=uploads&limit=100");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;
        Assert.True(root.GetProperty("ok").GetBoolean());
        Assert.Equal("uploads", root.GetProperty("path").GetString());
        var files = root.GetProperty("files");
        Assert.True(files.GetArrayLength() >= 1);
        Assert.Contains(files.EnumerateArray(), item => item.GetProperty("fileId").GetString() == fileId);
        Assert.True(File.Exists(storedPath));
    }

    [Fact]
    public async Task FilesDownloadEndpoint_SupportsRangeRequests()
    {
        var (client, fileId, _) = await UploadSampleFileAsync();

        using var request = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/files/download/{fileId}");
        request.Headers.Range = new RangeHeaderValue(0, 4);
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.PartialContent, response.StatusCode);
        Assert.Equal("text/plain", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("hello", await response.Content.ReadAsStringAsync());
        Assert.True(response.Content.Headers.ContentRange is not null);
        Assert.Equal(0, response.Content.Headers.ContentRange!.From);
        Assert.Equal(4, response.Content.Headers.ContentRange.To);
    }

    [Fact]
    public async Task FilesDeleteEndpoint_RemovesUploadedFileFromDisk()
    {
        var (client, fileId, storedPath) = await UploadSampleFileAsync();

        var response = await client.DeleteAsync($"/api/v1/files/{fileId}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.True(document.RootElement.GetProperty("deleted").GetBoolean());
        Assert.False(File.Exists(storedPath));
    }

    private async Task<(HttpClient Client, string FileId, string StoredPath)> UploadSampleFileAsync()
    {
        var client = await AuthTestHelper.CreateAuthorizedClientAsync(
            _factory,
            permissions: [Permission.ManageAgent]);

        using var multipart = new MultipartFormDataContent();
        var payload = new ByteArrayContent(Encoding.UTF8.GetBytes("hello file"));
        payload.Headers.ContentType = new MediaTypeHeaderValue("text/plain");
        multipart.Add(payload, "file", "notes.txt");
        multipart.Add(new StringContent("docs/inbox"), "targetPath");

        var response = await client.PostAsync("/api/v1/files/upload", multipart);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;
        Assert.True(root.GetProperty("ok").GetBoolean());
        Assert.False(string.IsNullOrWhiteSpace(root.GetProperty("fileId").GetString()));
        Assert.Equal("notes.txt", root.GetProperty("fileName").GetString());
        Assert.Equal("text/plain", root.GetProperty("mimeType").GetString());
        Assert.Equal(10, root.GetProperty("sizeBytes").GetInt64());

        var fileId = root.GetProperty("fileId").GetString()!;
        var storedPath = root.GetProperty("storedPath").GetString()!;
        return (client, fileId, storedPath);
    }
}
