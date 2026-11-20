using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace TypeSub.WinUI;

public sealed class BridgeClient : IDisposable
{
    private readonly HttpClient _http;
    private readonly CancellationTokenSource _stop = new();

    public event Action<string, JsonNode?>? EventReceived;

    public BridgeClient(string url, string token)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var endpoint) ||
            endpoint.Scheme != "http" || endpoint.Host != "127.0.0.1")
            throw new ArgumentException("Invalid local service endpoint.");
        _http = new HttpClient { BaseAddress = endpoint, Timeout = Timeout.InfiniteTimeSpan };
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
    }

    public async Task<JsonNode?> CallAsync(string method, params object?[] args)
    {
        var json = JsonSerializer.Serialize(new { method, args });
        using var response = await _http.PostAsync("/rpc", new StringContent(json, Encoding.UTF8, "application/json"));
        var result = JsonNode.Parse(await response.Content.ReadAsStringAsync());
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException(result?["message"]?.ToString() ?? "Service request failed.");
        return result;
    }

    public async Task ListenAsync()
    {
        while (!_stop.IsCancellationRequested)
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, "/events");
                using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, _stop.Token);
                response.EnsureSuccessStatusCode();
                await using var stream = await response.Content.ReadAsStreamAsync(_stop.Token);
                using var reader = new StreamReader(stream);
                while (!_stop.IsCancellationRequested && await reader.ReadLineAsync(_stop.Token) is { } line)
                {
                    if (!line.StartsWith("data: ", StringComparison.Ordinal)) continue;
                    var message = JsonNode.Parse(line[6..]);
                    if (message?["type"]?.ToString() is { } type) EventReceived?.Invoke(type, message["data"]);
                }
            }
            catch (OperationCanceledException) when (_stop.IsCancellationRequested) { break; }
            catch (Exception) when (!_stop.IsCancellationRequested)
            {
                try { await Task.Delay(1000, _stop.Token); }
                catch (OperationCanceledException) { break; }
            }
        }
    }

    public void Dispose()
    {
        _stop.Cancel();
        _http.Dispose();
        _stop.Dispose();
    }
}
