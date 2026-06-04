using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

namespace Ceryx.Agent.Codex.Clipboard;

internal sealed class Win32ClipboardBackend : IClipboardBackend
{
    private const uint ClipboardFormatText = 1;
    private const uint ClipboardFormatBitmap = 2;
    private const uint ClipboardFormatUnicodeText = 13;
    private const uint ClipboardFormatDib = 8;
    private const uint ClipboardFormatDibV5 = 17;
    private const uint GmemMoveable = 0x0002;
    private const uint GmemZeroInit = 0x0040;
    private const int RetryCount = 5;
    private const int RetryDelayMilliseconds = 10;

    public void Clear()
    {
        ExecuteWithClipboard(() =>
        {
            if (!EmptyClipboard())
            {
                ThrowLastWin32Error("Failed to clear clipboard.");
            }
        });
    }

    public void SetText(string text)
    {
        ExecuteWithClipboard(() =>
        {
            if (!EmptyClipboard())
            {
                ThrowLastWin32Error("Failed to prepare clipboard for text.");
            }

            SetClipboardHandle(ClipboardFormatUnicodeText, Encoding.Unicode.GetBytes(text + '\0'));
        });
    }

    public string? GetText()
    {
        return ExecuteWithClipboard(() =>
        {
            if (TryReadUnicodeText(out var unicodeText))
            {
                return unicodeText;
            }

            if (TryReadAnsiText(out var ansiText))
            {
                return ansiText;
            }

            return null;
        });
    }

    public void SetImage(byte[] imageBytes, string mimeType)
    {
        try
        {
            using var input = new MemoryStream(imageBytes, writable: false);
            using var source = Image.FromStream(input);
            using var bitmap = new Bitmap(source);
            using var bmpStream = new MemoryStream();
            bitmap.Save(bmpStream, ImageFormat.Bmp);

            var bmpBytes = bmpStream.ToArray();
            if (bmpBytes.Length <= 14)
            {
                throw new ClipboardBackendException("Failed to serialize image to clipboard format.");
            }

            var dibBytes = bmpBytes[14..];

            ExecuteWithClipboard(() =>
            {
                if (!EmptyClipboard())
                {
                    ThrowLastWin32Error("Failed to prepare clipboard for image.");
                }

                SetClipboardHandle(ClipboardFormatDib, dibBytes);
            });
        }
        catch (ArgumentException ex)
        {
            throw new ClipboardBackendException("Failed to serialize image to clipboard format.", ex);
        }
        catch (OutOfMemoryException ex)
        {
            throw new ClipboardBackendException("Failed to serialize image to clipboard format.", ex);
        }
        catch (ExternalException ex)
        {
            throw new ClipboardBackendException("Failed to serialize image to clipboard format.", ex);
        }
    }

    public ClipboardImageData? GetImage()
    {
        return ExecuteWithClipboard(() =>
        {
            if (TryReadDib(ClipboardFormatDibV5, out var imageFromDibV5))
            {
                return imageFromDibV5;
            }

            if (TryReadDib(ClipboardFormatDib, out var imageFromDib))
            {
                return imageFromDib;
            }

            if (TryReadBitmap(out var imageFromBitmap))
            {
                return imageFromBitmap;
            }

            return null;
        });
    }

    private static T ExecuteWithClipboard<T>(Func<T> action)
    {
        var lastError = 0;
        for (var attempt = 0; attempt < RetryCount; attempt++)
        {
            if (OpenClipboard(IntPtr.Zero))
            {
                try
                {
                    return action();
                }
                finally
                {
                    CloseClipboard();
                }
            }

            lastError = Marshal.GetLastWin32Error();
            Thread.Sleep(RetryDelayMilliseconds);
        }

        throw new ClipboardBackendException($"Failed to access the Windows clipboard. Win32Error={lastError}.");
    }

    private static void ExecuteWithClipboard(Action action)
    {
        _ = ExecuteWithClipboard(() =>
        {
            action();
            return true;
        });
    }

    private static bool TryReadUnicodeText(out string? text)
    {
        if (!IsClipboardFormatAvailable(ClipboardFormatUnicodeText))
        {
            text = null;
            return false;
        }

        var handle = GetClipboardData(ClipboardFormatUnicodeText);
        if (handle == IntPtr.Zero)
        {
            text = null;
            return false;
        }

        var pointer = GlobalLock(handle);
        if (pointer == IntPtr.Zero)
        {
            ThrowLastWin32Error("Failed to lock unicode clipboard text.");
        }

        try
        {
            text = Marshal.PtrToStringUni(pointer);
            return text is not null;
        }
        finally
        {
            GlobalUnlock(handle);
        }
    }

    private static bool TryReadAnsiText(out string? text)
    {
        if (!IsClipboardFormatAvailable(ClipboardFormatText))
        {
            text = null;
            return false;
        }

        var handle = GetClipboardData(ClipboardFormatText);
        if (handle == IntPtr.Zero)
        {
            text = null;
            return false;
        }

        var bytes = ReadGlobalBytes(handle);
        var length = Array.IndexOf(bytes, (byte)0);
        if (length < 0)
        {
            length = bytes.Length;
        }

        text = Encoding.Default.GetString(bytes, 0, length);
        return true;
    }

    private static bool TryReadBitmap(out ClipboardImageData? image)
    {
        if (!IsClipboardFormatAvailable(ClipboardFormatBitmap))
        {
            image = null;
            return false;
        }

        var handle = GetClipboardData(ClipboardFormatBitmap);
        if (handle == IntPtr.Zero)
        {
            image = null;
            return false;
        }

        try
        {
            using var bitmap = Image.FromHbitmap(handle);
            using var pngStream = new MemoryStream();
            bitmap.Save(pngStream, ImageFormat.Png);

            image = new ClipboardImageData(pngStream.ToArray(), "image/png");
            return true;
        }
        catch (ArgumentException ex)
        {
            throw new ClipboardBackendException("Clipboard bitmap payload is invalid.", ex);
        }
        catch (OutOfMemoryException ex)
        {
            throw new ClipboardBackendException("Clipboard bitmap payload is invalid.", ex);
        }
        catch (ExternalException ex)
        {
            throw new ClipboardBackendException("Clipboard bitmap payload is invalid.", ex);
        }
    }

    private static bool TryReadDib(uint format, out ClipboardImageData? image)
    {
        if (!IsClipboardFormatAvailable(format))
        {
            image = null;
            return false;
        }

        var handle = GetClipboardData(format);
        if (handle == IntPtr.Zero)
        {
            image = null;
            return false;
        }

        var dibBytes = ReadGlobalBytes(handle);
        var bmpBytes = CreateBmpBytesFromDib(dibBytes);

        try
        {
            using var bmpStream = new MemoryStream(bmpBytes);
            using var bitmap = Image.FromStream(bmpStream);
            using var pngStream = new MemoryStream();
            bitmap.Save(pngStream, ImageFormat.Png);

            image = new ClipboardImageData(pngStream.ToArray(), "image/png");
            return true;
        }
        catch (ArgumentException ex)
        {
            throw new ClipboardBackendException("Clipboard image payload is invalid.", ex);
        }
        catch (OutOfMemoryException ex)
        {
            throw new ClipboardBackendException("Clipboard image payload is invalid.", ex);
        }
        catch (ExternalException ex)
        {
            throw new ClipboardBackendException("Clipboard image payload is invalid.", ex);
        }
    }

    private static byte[] ReadGlobalBytes(IntPtr handle)
    {
        var size = GlobalSize(handle);
        if (size == 0)
        {
            ThrowLastWin32Error("Failed to determine clipboard buffer size.");
        }

        if (size > int.MaxValue)
        {
            throw new ClipboardBackendException("Clipboard buffer exceeds supported size.");
        }

        var pointer = GlobalLock(handle);
        if (pointer == IntPtr.Zero)
        {
            ThrowLastWin32Error("Failed to lock clipboard buffer.");
        }

        try
        {
            var bytes = new byte[(int)size];
            Marshal.Copy(pointer, bytes, 0, bytes.Length);
            return bytes;
        }
        finally
        {
            GlobalUnlock(handle);
        }
    }

    private static byte[] CreateBmpBytesFromDib(byte[] dibBytes)
    {
        if (dibBytes.Length < 40)
        {
            throw new ClipboardBackendException("Clipboard image payload is too small.");
        }

        var headerSize = BitConverter.ToInt32(dibBytes, 0);
        var bitCount = BitConverter.ToUInt16(dibBytes, 14);
        var clrUsed = headerSize >= 36 ? BitConverter.ToUInt32(dibBytes, 32) : 0U;

        var colorTableEntries = bitCount <= 8
            ? (int)(clrUsed != 0 ? clrUsed : 1U << bitCount)
            : 0;
        var colorTableBytes = colorTableEntries * 4;
        var pixelOffset = 14 + headerSize + colorTableBytes;

        var bmpBytes = new byte[14 + dibBytes.Length];
        bmpBytes[0] = (byte)'B';
        bmpBytes[1] = (byte)'M';
        BitConverter.GetBytes(bmpBytes.Length).CopyTo(bmpBytes, 2);
        BitConverter.GetBytes(pixelOffset).CopyTo(bmpBytes, 10);
        Buffer.BlockCopy(dibBytes, 0, bmpBytes, 14, dibBytes.Length);
        return bmpBytes;
    }

    private static void SetClipboardHandle(uint format, byte[] bytes)
    {
        var handle = GlobalAlloc(GmemMoveable | GmemZeroInit, (nuint)bytes.Length);
        if (handle == IntPtr.Zero)
        {
            ThrowLastWin32Error("Failed to allocate clipboard buffer.");
        }

        var pointer = GlobalLock(handle);
        if (pointer == IntPtr.Zero)
        {
            GlobalFree(handle);
            ThrowLastWin32Error("Failed to lock clipboard buffer.");
        }

        try
        {
            Marshal.Copy(bytes, 0, pointer, bytes.Length);
        }
        finally
        {
            GlobalUnlock(handle);
        }

        if (SetClipboardData(format, handle) == IntPtr.Zero)
        {
            GlobalFree(handle);
            ThrowLastWin32Error("Failed to update clipboard contents.");
        }
    }

    private static void ThrowLastWin32Error(string message)
    {
        var error = Marshal.GetLastWin32Error();
        throw new ClipboardBackendException($"{message} Win32Error={error}.");
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool OpenClipboard(IntPtr hWndNewOwner);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool CloseClipboard();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EmptyClipboard();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr GetClipboardData(uint uFormat);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetClipboardData(uint uFormat, IntPtr hMem);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool IsClipboardFormatAvailable(uint format);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalAlloc(uint uFlags, nuint dwBytes);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalLock(IntPtr hMem);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GlobalUnlock(IntPtr hMem);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern nuint GlobalSize(IntPtr hMem);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalFree(IntPtr hMem);
}
