using Ceryx.Agent.Codex.Clipboard;
using Ceryx.Agent.Core;

namespace Ceryx.Agent.Codex.Input;

public interface IPromptBridgeService
{
    Task<PromptSendResponse> SendPromptAsync(
        InputExecutionContext context,
        PromptSendBody body,
        CancellationToken cancellationToken = default);
}

public sealed class PromptBridgeService : IPromptBridgeService
{
    private readonly IClipboardService _clipboardService;

    public PromptBridgeService(IClipboardService clipboardService)
    {
        _clipboardService = clipboardService ?? throw new ArgumentNullException(nameof(clipboardService));
    }

    public async Task<PromptSendResponse> SendPromptAsync(
        InputExecutionContext context,
        PromptSendBody body,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(body);
        if (string.IsNullOrWhiteSpace(body.Prompt))
        {
            throw new ArgumentException("Prompt cannot be empty.", nameof(body));
        }

        await _clipboardService.SetTextAsync(body.Prompt, cancellationToken);
        return new PromptSendResponse(
            Ok: true,
            Status: "sent",
            Submitted: body.Submit);
    }
}
